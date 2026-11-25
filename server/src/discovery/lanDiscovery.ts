import dgram from 'node:dgram';
import { envConfig, getLanAddresses } from '../config.js';
import type { DvrDatabase } from '../db/database.js';

const DISCOVERY_MAGIC = 'AIRVAULT_DVR_DISCOVER';

/**
 * Lightweight UDP LAN Discovery Responder so Android TV, Google TV, and Fire TV apps
 * automatically find the whole-house DVR server on the local network without typing an IP.
 */
export class LanDiscoveryResponder {
  private socket: dgram.Socket | null = null;

  constructor(private db: DvrDatabase) {}

  start(): void {
    this.stop();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err) => {
      console.warn('[Discovery] UDP beacon warning:', err.message);
    });

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8').trim();
      if (!text.startsWith(DISCOVERY_MAGIC)) return;

      const settings = this.db.getSettings();
      const response = JSON.stringify({
        service: 'airvault-dvr',
        version: '1.0.0',
        serverName: settings.serverName,
        port: envConfig.port,
        addresses: getLanAddresses(),
      });
      const buf = Buffer.from(response, 'utf8');
      socket.send(buf, 0, buf.length, rinfo.port, rinfo.address);
    });

    socket.bind(envConfig.discoveryUdpPort, () => {
      console.log(
        `[Discovery] Whole-house TV discovery responder listening on UDP :${envConfig.discoveryUdpPort}`,
      );
    });

    this.socket = socket;
  }

  stop(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }
}
