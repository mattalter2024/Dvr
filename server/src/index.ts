import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { ensureDirectories, envConfig, getLanAddresses } from './config.js';
import { DvrDatabase } from './db/database.js';
import { TunerPool } from './tuners/tunerPool.js';
import { createVirtualChannels, createVirtualTunerDevice } from './tuners/virtualTuner.js';
import { EpgService } from './epg/epgService.js';
import { CommercialSkipService } from './dvr/commercialSkip.js';
import { DvrRecorder } from './dvr/recorder.js';
import { DvrScheduler } from './dvr/scheduler.js';
import { HlsLiveManager } from './streaming/hlsManager.js';
import { LanDiscoveryResponder } from './discovery/lanDiscovery.js';
import { createApiRouter } from './routes/api.js';
import type { WsEvent } from './types/index.js';

export async function createServer() {
  ensureDirectories();
  const db = new DvrDatabase();
  await db.init();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcast = (type: string, payload: unknown) => {
    const event: WsEvent = {
      type: type as WsEvent['type'],
      payload,
      timestamp: new Date().toISOString(),
    };
    const msg = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  };

  const tunerPool = new TunerPool(db, () => {
    broadcast('tuner_update', tunerPool.getTunerUtilization());
  });

  const epg = new EpgService(db, () => {
    broadcast('guide_updated', epg.getStatus());
  });

  const commercialSkip = new CommercialSkipService(db, (recordingId, segments) => {
    broadcast('commercials_scanned', { recordingId, count: segments.length, segments });
  });

  const recorder = new DvrRecorder(db, tunerPool, commercialSkip, (type, payload) => {
    broadcast(type, payload);
  });

  const scheduler = new DvrScheduler(db, tunerPool, recorder, () => {
    broadcast('schedule_updated', {});
  });

  const hls = new HlsLiveManager(db, tunerPool);
  const discovery = new LanDiscoveryResponder(db);

  // Bootstrap virtual OTA tuner + sample guide on first launch when enabled
  const settings = db.getSettings();
  if (settings.enableVirtualTuner && db.listTuners().length === 0) {
    db.upsertTuner(createVirtualTunerDevice(settings.virtualTunerCount));
    for (const ch of createVirtualChannels()) {
      db.upsertChannel(ch);
    }
  }

  // Ensure EPG has data on startup
  const now = new Date();
  const existingPrograms = db.queryProgramsInRange(
    now.toISOString(),
    new Date(now.getTime() + 6 * 3600 * 1000).toISOString(),
  );
  if (existingPrograms.length === 0 && db.listChannels(true).length > 0) {
    await epg.refreshGuide().catch((err) => {
      console.warn('[EPG] Initial guide refresh fell back to sample:', err);
      epg.generateSampleGuide(48);
    });
  }

  // Recover any stale 'recording' rows from an abrupt crash
  for (const stale of db.listRecordings(['recording'])) {
    db.updateRecording(stale.id, {
      status: 'failed',
      errorMessage: 'Interrupted by server restart',
    });
  }

  // Mount REST API
  app.use(
    '/api',
    createApiRouter({
      db,
      tunerPool,
      epg,
      scheduler,
      recorder,
      commercialSkip,
      hls,
      broadcast,
    }),
  );

  // Serve built 10-foot Smart TV Web UI with aggressive caching on hashed assets
  if (fs.existsSync(envConfig.webDistDir)) {
    app.use(
      '/assets',
      express.static(path.join(envConfig.webDistDir, 'assets'), {
        maxAge: '1y',
        immutable: true,
      }),
    );
    app.use(
      express.static(envConfig.webDistDir, {
        etag: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(envConfig.webDistDir, 'index.html'));
    });
  }

  scheduler.start();
  hls.start();
  epg.startAutoRefresh();
  discovery.start();

  const shutdown = () => {
    scheduler.stop();
    epg.stopAutoRefresh();
    recorder.stopAll();
    hls.stop();
    discovery.stop();
    db.close();
    httpServer.close();
  };

  return { app, httpServer, db, shutdown };
}

// Entrypoint when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'));

if (isDirectRun) {
  createServer()
    .then(({ httpServer, shutdown }) => {
      httpServer.listen(envConfig.port, envConfig.host, () => {
        const lanIps = getLanAddresses();
        console.log('=======================================================');
        console.log(`  AirVault Whole-House OTA DVR Server running`);
        console.log(`  Local:   http://localhost:${envConfig.port}`);
        for (const ip of lanIps) {
          console.log(`  Home LAN: http://${ip}:${envConfig.port}`);
        }
        console.log('=======================================================');
      });

      process.on('SIGINT', () => {
        shutdown();
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        shutdown();
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Failed to start AirVault DVR Server:', err);
      process.exit(1);
    });
}
