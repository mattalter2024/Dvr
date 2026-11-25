import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { detectCapabilities } from '../config.js';
import type { DvrDatabase } from '../db/database.js';
import type { TunerPool } from '../tuners/tunerPool.js';
import { discoverHdHomeRunIps, probeHdHomeRun } from '../tuners/hdhomerun.js';
import {
  VIRTUAL_TUNER_ID,
  createVirtualChannels,
  createVirtualTunerDevice,
} from '../tuners/virtualTuner.js';
import type { EpgService } from '../epg/epgService.js';
import type { DvrScheduler } from '../dvr/scheduler.js';
import type { DvrRecorder } from '../dvr/recorder.js';
import { CommercialSkipService, serializeEdl } from '../dvr/commercialSkip.js';
import type { HlsLiveManager } from '../streaming/hlsManager.js';
import type { CommercialSegment, DvrSettings } from '../types/index.js';

export interface ApiDeps {
  db: DvrDatabase;
  tunerPool: TunerPool;
  epg: EpgService;
  scheduler: DvrScheduler;
  recorder: DvrRecorder;
  commercialSkip: CommercialSkipService;
  hls: HlsLiveManager;
  broadcast: (type: string, payload: unknown) => void;
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const { db, tunerPool, epg, scheduler, recorder, commercialSkip, hls, broadcast } = deps;

  // ==================== HEALTH & SYSTEM ====================

  router.get('/health', (_req, res) => {
    const settings = db.getSettings();
    const capabilities = detectCapabilities(settings);
    res.json({
      status: 'ok',
      service: 'airvault-dvr',
      version: '1.0.0',
      serverName: settings.serverName,
      capabilities,
      epg: epg.getStatus(),
      stats: {
        tuners: db.listTuners().length,
        channels: db.listChannels(false).length,
        activeRecordings: recorder.getActiveRecordingIds().length,
        activeLiveSessions: hls.listSessions().length,
        completedRecordings: db.listRecordings(['completed']).length,
      },
    });
  });

  // ==================== SETTINGS ====================

  router.get('/settings', (_req, res) => {
    const settings = db.getSettings();
    res.json({
      settings,
      capabilities: detectCapabilities(settings),
    });
  });

  router.put('/settings', (req, res) => {
    const patch = req.body as Partial<DvrSettings>;
    const updated = db.updateSettings(patch);

    if (patch.enableVirtualTuner !== undefined || patch.virtualTunerCount !== undefined) {
      if (updated.enableVirtualTuner) {
        db.upsertTuner(createVirtualTunerDevice(updated.virtualTunerCount));
        for (const ch of createVirtualChannels()) {
          db.upsertChannel(ch);
        }
      } else {
        db.deleteTuner(VIRTUAL_TUNER_ID);
      }
      broadcast('tuner_update', tunerPool.getTunerUtilization());
    }

    epg.startAutoRefresh();
    res.json({
      settings: updated,
      capabilities: detectCapabilities(updated),
    });
  });

  // ==================== TUNERS & HDHOMERUN ====================

  router.get('/tuners', (_req, res) => {
    res.json({
      tuners: tunerPool.getTunerUtilization(),
      activeLeases: tunerPool.getActiveLeases(),
    });
  });

  router.post('/tuners/discover', async (_req, res) => {
    try {
      const ips = await discoverHdHomeRunIps(2000);
      const discovered = [];
      for (const ip of ips) {
        try {
          const { tuner, channels } = await probeHdHomeRun(ip);
          db.upsertTuner(tuner);
          for (const ch of channels) db.upsertChannel(ch);
          discovered.push({ tuner, channelCount: channels.length });
        } catch (err) {
          console.warn(`[HDHR] Probe failed for ${ip}:`, err);
        }
      }
      broadcast('tuner_update', tunerPool.getTunerUtilization());
      res.json({ discoveredIps: ips, discovered });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Discovery failed' });
    }
  });

  router.post('/tuners/hdhomerun', async (req, res) => {
    const { host } = req.body as { host?: string };
    if (!host || !host.trim()) {
      res.status(400).json({ error: 'HDHomeRun IP address or hostname is required' });
      return;
    }
    try {
      const { tuner, channels } = await probeHdHomeRun(host.trim());
      db.upsertTuner(tuner);
      for (const ch of channels) db.upsertChannel(ch);
      broadcast('tuner_update', tunerPool.getTunerUtilization());
      res.status(201).json({ tuner, channelCount: channels.length });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to reach HDHomeRun device',
      });
    }
  });

  router.post('/tuners/virtual', (req, res) => {
    const tunerCount = Math.max(1, Math.min(8, Number(req.body?.tunerCount ?? 2)));
    const tuner = createVirtualTunerDevice(tunerCount);
    db.upsertTuner(tuner);
    const channels = createVirtualChannels();
    for (const ch of channels) db.upsertChannel(ch);
    db.updateSettings({ enableVirtualTuner: true, virtualTunerCount: tunerCount });
    epg.generateSampleGuide(48);
    broadcast('tuner_update', tunerPool.getTunerUtilization());
    res.status(201).json({ tuner, channelCount: channels.length });
  });

  router.delete('/tuners/:id', (req, res) => {
    db.deleteTuner(req.params.id);
    if (req.params.id === VIRTUAL_TUNER_ID) {
      db.updateSettings({ enableVirtualTuner: false });
    }
    broadcast('tuner_update', tunerPool.getTunerUtilization());
    res.status(204).end();
  });

  // ==================== CHANNELS ====================

  router.get('/channels', (req, res) => {
    const includeDisabled = req.query.all === 'true';
    res.json({ channels: db.listChannels(includeDisabled) });
  });

  router.patch('/channels/:id', (req, res) => {
    const updated = db.updateChannel(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    res.json({ channel: updated });
  });

  // ==================== EPG / TV GUIDE ====================

  router.get('/guide', (req, res) => {
    const now = new Date();
    const defaultStart = new Date(
      Math.floor(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000),
    );
    const hours = Math.min(48, Math.max(1, Number(req.query.hours ?? 6)));
    const startIso =
      typeof req.query.start === 'string' ? req.query.start : defaultStart.toISOString();
    const endIso =
      typeof req.query.end === 'string'
        ? req.query.end
        : new Date(Date.parse(startIso) + hours * 3600 * 1000).toISOString();

    const grid = epg.getGuideGrid(startIso, endIso);
    const recordings = db.listRecordings(['scheduled', 'recording', 'conflict']);
    const recordingByProgramId: Record<string, { id: string; status: string }> = {};
    for (const r of recordings) {
      if (r.programId) {
        recordingByProgramId[r.programId] = { id: r.id, status: r.status };
      }
    }

    res.json({ ...grid, recordingByProgramId });
  });

  router.get('/guide/now', (_req, res) => {
    res.json({ items: epg.getNowPlaying() });
  });

  router.get('/guide/search', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json({ programs: [] });
      return;
    }
    res.json({ programs: db.searchPrograms(q, 60) });
  });

  router.post('/guide/xmltv', async (req, res) => {
    const source = String(req.body?.source ?? db.getSettings().xmltvUrl ?? '').trim();
    if (!source) {
      res.status(400).json({ error: 'XMLTV URL or local file path is required' });
      return;
    }
    try {
      const result = await epg.importXmltv(source);
      if (req.body?.saveUrl !== false) {
        db.updateSettings({ xmltvUrl: source });
      }
      const scheduledFromPasses = scheduler.applyAllSeriesPasses();
      res.json({ ...result, scheduledFromPasses });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'XMLTV import failed',
      });
    }
  });

  router.post('/guide/sample', (req, res) => {
    const hours = Math.min(168, Math.max(6, Number(req.body?.hours ?? 48)));
    const result = epg.generateSampleGuide(hours);
    const scheduledFromPasses = scheduler.applyAllSeriesPasses();
    res.json({ ...result, scheduledFromPasses });
  });

  // ==================== LIVE TV STREAMING ====================

  router.get('/live', (_req, res) => {
    res.json({ sessions: hls.listSessions() });
  });

  router.post('/live/start', async (req, res) => {
    const channelId = String(req.body?.channelId ?? '');
    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }
    try {
      const session = await hls.startOrJoinChannel(channelId);
      res.status(201).json({ session });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'Unable to start live stream',
      });
    }
  });

  router.post('/live/:sessionId/heartbeat', (req, res) => {
    const session = hls.heartbeat(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Live session not found' });
      return;
    }
    res.json({ session });
  });

  router.delete('/live/:sessionId', (req, res) => {
    hls.leaveSession(req.params.sessionId);
    res.status(204).end();
  });

  // Serve HLS playlist & .ts segments for an active live TV session
  router.get('/live/:sessionId/:filename', (req, res) => {
    const dir = hls.getSessionDir(req.params.sessionId);
    if (!dir) {
      res.status(404).json({ error: 'Live session not found' });
      return;
    }
    const safeName = path.basename(req.params.filename);
    if (safeName === 'direct.ts') {
      void proxyDirectHdhrStream(req, res, deps);
      return;
    }

    const filePath = path.join(dir, safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).end();
      return;
    }

    hls.heartbeat(req.params.sessionId);
    if (safeName.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (safeName.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=60');
    }
    fs.createReadStream(filePath).pipe(res);
  });

  // ==================== DVR RECORDINGS & COMMERCIAL SKIPPING ====================

  router.get('/recordings', (req, res) => {
    const statusParam = typeof req.query.status === 'string' ? req.query.status : '';
    const statuses = statusParam
      ? (statusParam.split(',').filter(Boolean) as Array<
          'scheduled' | 'recording' | 'completed' | 'failed' | 'cancelled' | 'conflict'
        >)
      : undefined;
    const recordings = db.listRecordings(statuses);
    res.json({ recordings });
  });

  router.get('/recordings/:id', (req, res) => {
    const recording = db.getRecording(req.params.id);
    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }
    const commercials = db.listCommercials(recording.id);
    res.json({ recording, commercials });
  });

  router.post('/recordings/schedule', (req, res) => {
    const { programId, paddingStartMin, paddingEndMin } = req.body as {
      programId?: string;
      paddingStartMin?: number;
      paddingEndMin?: number;
    };
    if (!programId) {
      res.status(400).json({ error: 'programId is required' });
      return;
    }
    try {
      const recording = scheduler.scheduleProgram(programId, { paddingStartMin, paddingEndMin });
      res.status(201).json({ recording });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Schedule failed' });
    }
  });

  router.post('/recordings/now', async (req, res) => {
    const { channelId, durationMinutes, title } = req.body as {
      channelId?: string;
      durationMinutes?: number;
      title?: string;
    };
    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }
    try {
      const recording = await scheduler.recordNow(channelId, durationMinutes ?? 30, title);
      res.status(201).json({ recording });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Record now failed' });
    }
  });

  router.post('/recordings/:id/stop', (req, res) => {
    const stopped = recorder.stopRecording(req.params.id);
    if (!stopped) {
      const rec = db.getRecording(req.params.id);
      if (rec && (rec.status === 'scheduled' || rec.status === 'conflict')) {
        db.updateRecording(rec.id, { status: 'cancelled' });
        scheduler.evaluateConflicts();
        res.json({ stopped: true });
        return;
      }
      res.status(404).json({ error: 'Active recording not found' });
      return;
    }
    res.json({ stopped: true });
  });

  router.patch('/recordings/:id/progress', (req, res) => {
    const positionSec = Math.max(0, Number(req.body?.positionSec ?? 0));
    const watched =
      req.body?.watched !== undefined ? Boolean(req.body.watched) : undefined;
    const rec = db.getRecording(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }
    const autoWatched =
      watched !== undefined
        ? watched
        : rec.durationSec > 60 && positionSec >= rec.durationSec * 0.92;
    const updated = db.updateRecording(rec.id, {
      watchedPositionSec: positionSec,
      watched: autoWatched,
    });
    res.json({ recording: updated });
  });

  // Commercial break markers (JSON + standard .edl + manual edit + re-scan)
  router.get('/recordings/:id/commercials', (req, res) => {
    const rec = db.getRecording(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }
    const commercials = db.listCommercials(rec.id);
    res.json({ recordingId: rec.id, status: rec.commercialScanStatus, commercials });
  });

  router.get('/recordings/:id/commercials.edl', (req, res) => {
    const rec = db.getRecording(req.params.id);
    if (!rec) {
      res.status(404).end();
      return;
    }
    const commercials = db.listCommercials(rec.id);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(serializeEdl(commercials));
  });

  router.put('/recordings/:id/commercials', (req, res) => {
    const rec = db.getRecording(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }
    const rawList = Array.isArray(req.body?.commercials) ? req.body.commercials : [];
    const segments: CommercialSegment[] = rawList
      .map((item: { startSec?: number; endSec?: number }) => ({
        id: uuid(),
        recordingId: rec.id,
        startSec: Number(item.startSec),
        endSec: Number(item.endSec),
        confidence: 1.0,
        source: 'manual' as const,
      }))
      .filter(
        (s: CommercialSegment) =>
          Number.isFinite(s.startSec) && Number.isFinite(s.endSec) && s.endSec > s.startSec,
      );

    db.replaceCommercials(rec.id, segments);
    if (rec.filePath && fs.existsSync(rec.filePath)) {
      const edlPath = rec.filePath.replace(/\.[^.]+$/, '.edl');
      fs.writeFileSync(edlPath, serializeEdl(segments), 'utf8');
    }
    res.json({ commercials: segments });
  });

  router.post('/recordings/:id/scan-commercials', async (req, res) => {
    try {
      const segments = await commercialSkip.scanRecording(req.params.id);
      res.json({ commercials: segments });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Commercial scan failed',
      });
    }
  });

  // HTTP Range streaming for completed & in-progress (chase-play) DVR recordings
  router.get('/recordings/:id/stream', (req, res) => {
    const rec = db.getRecording(req.params.id);
    if (!rec || !rec.filePath || !fs.existsSync(rec.filePath)) {
      res.status(404).json({
        error: 'Recording media file is not available (FFmpeg may not have been installed during capture)',
      });
      return;
    }

    const stat = fs.statSync(rec.filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = rec.filePath.endsWith('.ts') ? 'video/mp2t' : 'video/mp4';

    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      const start = Number.parseInt(match[1], 10);
      const end = match[2] ? Math.min(fileSize - 1, Number.parseInt(match[2], 10)) : fileSize - 1;
      if (start >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(rec.filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
      });
      fs.createReadStream(rec.filePath).pipe(res);
    }
  });

  router.get('/recordings/:id/thumbnail', (req, res) => {
    const rec = db.getRecording(req.params.id);
    if (!rec?.thumbnailPath || !fs.existsSync(rec.thumbnailPath)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    fs.createReadStream(rec.thumbnailPath).pipe(res);
  });

  router.delete('/recordings/:id', (req, res) => {
    const rec = db.getRecording(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }
    if (recorder.isRecording(rec.id)) {
      recorder.stopRecording(rec.id);
    }
    if (rec.filePath && fs.existsSync(rec.filePath)) {
      try {
        fs.unlinkSync(rec.filePath);
        const edl = rec.filePath.replace(/\.[^.]+$/, '.edl');
        if (fs.existsSync(edl)) fs.unlinkSync(edl);
      } catch {
        // ignore
      }
    }
    if (rec.thumbnailPath && fs.existsSync(rec.thumbnailPath)) {
      try {
        fs.unlinkSync(rec.thumbnailPath);
      } catch {
        // ignore
      }
    }
    db.deleteRecording(rec.id);
    scheduler.evaluateConflicts();
    broadcast('schedule_updated', {});
    res.status(204).end();
  });

  // ==================== SERIES PASSES ====================

  router.get('/series-passes', (_req, res) => {
    res.json({ seriesPasses: db.listSeriesPasses() });
  });

  router.post('/series-passes', (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    if (!title) {
      res.status(400).json({ error: 'Series title is required' });
      return;
    }
    const result = scheduler.createSeriesPass({
      title,
      channelId: req.body?.channelId ?? null,
      newOnly: Boolean(req.body?.newOnly),
      paddingStartMin: req.body?.paddingStartMin,
      paddingEndMin: req.body?.paddingEndMin,
      keepLimit: Number(req.body?.keepLimit ?? 0),
      priority: Number(req.body?.priority ?? 50),
    });
    res.status(201).json(result);
  });

  router.patch('/series-passes/:id', (req, res) => {
    const existing = db.getSeriesPass(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Series pass not found' });
      return;
    }
    const next = {
      ...existing,
      newOnly: req.body?.newOnly !== undefined ? Boolean(req.body.newOnly) : existing.newOnly,
      paddingStartMin:
        req.body?.paddingStartMin !== undefined
          ? Number(req.body.paddingStartMin)
          : existing.paddingStartMin,
      paddingEndMin:
        req.body?.paddingEndMin !== undefined
          ? Number(req.body.paddingEndMin)
          : existing.paddingEndMin,
      keepLimit:
        req.body?.keepLimit !== undefined ? Number(req.body.keepLimit) : existing.keepLimit,
      priority: req.body?.priority !== undefined ? Number(req.body.priority) : existing.priority,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : existing.enabled,
    };
    db.upsertSeriesPass(next);
    scheduler.applyAllSeriesPasses();
    res.json({ seriesPass: next });
  });

  router.delete('/series-passes/:id', (req, res) => {
    db.deleteSeriesPass(req.params.id);
    broadcast('schedule_updated', {});
    res.status(204).end();
  });

  return router;
}

async function proxyDirectHdhrStream(req: Request, res: Response, deps: ApiDeps): Promise<void> {
  const session = deps.hls.listSessions().find((s) => s.id === req.params.sessionId);
  if (!session) {
    res.status(404).end();
    return;
  }
  const channel = deps.db.getChannel(session.channelId);
  if (!channel || channel.streamUrl.startsWith('virtual://')) {
    res.status(400).json({ error: 'Direct TS proxy is only available for network tuners' });
    return;
  }

  try {
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const upstream = await fetch(channel.streamUrl, { signal: controller.signal });
    if (!upstream.ok || !upstream.body) {
      res.status(502).end();
      return;
    }
    res.setHeader('Content-Type', 'video/mp2t');
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) res.write(Buffer.from(value));
      }
      if (!res.writableEnded) res.end();
    };
    await pump();
  } catch {
    if (!res.writableEnded) res.end();
  }
}
