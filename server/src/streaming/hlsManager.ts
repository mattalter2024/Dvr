import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { v4 as uuid } from 'uuid';
import { envConfig, detectCapabilities } from '../config.js';
import type { DvrDatabase } from '../db/database.js';
import type { TunerPool } from '../tuners/tunerPool.js';
import { buildVirtualFfmpegInputArgs } from '../tuners/virtualTuner.js';
import type { Channel, LiveSession } from '../types/index.js';

interface ActiveHlsSession {
  info: LiveSession;
  leaseId: string;
  dir: string;
  process: ChildProcess | null;
  lastHeartbeatMs: number;
}

export class HlsLiveManager {
  private sessionsByChannel = new Map<string, ActiveHlsSession>();
  private sessionsById = new Map<string, ActiveHlsSession>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private db: DvrDatabase, private tunerPool: TunerPool) {}

  start(): void {
    this.stop();
    this.cleanupTimer = setInterval(() => this.cleanupIdleSessions(), 10_000);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const id of Array.from(this.sessionsById.keys())) {
      this.stopSession(id);
    }
  }

  listSessions(): LiveSession[] {
    return Array.from(this.sessionsById.values()).map((s) => s.info);
  }

  getSessionDir(sessionId: string): string | null {
    return this.sessionsById.get(sessionId)?.dir ?? null;
  }

  heartbeat(sessionId: string): LiveSession | null {
    const sess = this.sessionsById.get(sessionId);
    if (!sess) return null;
    sess.lastHeartbeatMs = Date.now();
    sess.info.lastHeartbeatAt = new Date(sess.lastHeartbeatMs).toISOString();
    return sess.info;
  }

  /**
   * Starts or joins an active whole-house Live TV HLS session for `channelId`.
   * If another TV in the home is already watching the same channel, both TVs share the same
   * tuner slot and FFmpeg HLS pipeline!
   */
  async startOrJoinChannel(channelId: string): Promise<LiveSession> {
    const existing = this.sessionsByChannel.get(channelId);
    if (existing) {
      existing.lastHeartbeatMs = Date.now();
      existing.info.lastHeartbeatAt = new Date(existing.lastHeartbeatMs).toISOString();
      existing.info.viewerCount += 1;
      return existing.info;
    }

    const channel = this.db.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const sessionId = uuid();
    const lease = this.tunerPool.acquire(channel, 'live', sessionId);
    const settings = this.db.getSettings();
    const caps = detectCapabilities(settings);

    const sessionDir = path.join(envConfig.hlsDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const playlistFile = path.join(sessionDir, 'index.m3u8');

    const nowIso = new Date().toISOString();
    const isVirtual = channel.streamUrl.startsWith('virtual://');

    const info: LiveSession = {
      id: sessionId,
      channelId: channel.id,
      channelNumber: channel.guideNumber,
      channelName: channel.guideName,
      tunerId: channel.tunerId,
      playlistUrl: `/api/live/${sessionId}/index.m3u8`,
      directStreamUrl: isVirtual ? null : `/api/live/${sessionId}/direct.ts`,
      mode: caps.ffmpegAvailable ? 'hls-ffmpeg' : isVirtual ? 'simulated' : 'direct-proxy',
      startedAt: nowIso,
      lastHeartbeatAt: nowIso,
      viewerCount: 1,
    };

    let child: ChildProcess | null = null;
    if (caps.ffmpegAvailable) {
      const args = this.buildLiveHlsFfmpegArgs(
        channel,
        sessionDir,
        playlistFile,
        isVirtual,
        settings.transcodeLiveTv,
      );
      child = spawn(settings.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      child.on('exit', () => {
        if (this.sessionsById.has(sessionId)) {
          this.stopSession(sessionId);
        }
      });
    }

    const active: ActiveHlsSession = {
      info,
      leaseId: lease.id,
      dir: sessionDir,
      process: child,
      lastHeartbeatMs: Date.now(),
    };
    this.sessionsByChannel.set(channelId, active);
    this.sessionsById.set(sessionId, active);

    // Wait briefly for FFmpeg to produce the initial HLS playlist so the TV player starts cleanly
    if (child) {
      await this.waitForPlaylist(playlistFile, 7000);
    }

    return info;
  }

  leaveSession(sessionId: string): void {
    const sess = this.sessionsById.get(sessionId);
    if (!sess) return;
    sess.info.viewerCount = Math.max(0, sess.info.viewerCount - 1);
    if (sess.info.viewerCount === 0) {
      // Allow a short grace period for quick channel zapping or page reload
      sess.lastHeartbeatMs = Date.now() - 30_000;
    }
  }

  stopSession(sessionId: string): void {
    const sess = this.sessionsById.get(sessionId);
    if (!sess) return;
    this.sessionsById.delete(sessionId);
    if (this.sessionsByChannel.get(sess.info.channelId)?.info.id === sessionId) {
      this.sessionsByChannel.delete(sess.info.channelId);
    }

    try {
      sess.process?.kill('SIGTERM');
    } catch {
      // ignore
    }
    this.tunerPool.release(sess.leaseId);

    try {
      fs.rmSync(sess.dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [id, sess] of this.sessionsById.entries()) {
      if (now - sess.lastHeartbeatMs > 45_000) {
        this.stopSession(id);
      }
    }
  }

  private waitForPlaylist(playlistFile: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (fs.existsSync(playlistFile) && fs.statSync(playlistFile).size > 20) {
          resolve();
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  private buildLiveHlsFfmpegArgs(
    channel: Channel,
    sessionDir: string,
    playlistFile: string,
    isVirtual: boolean,
    transcode: boolean,
  ): string[] {
    const segmentPattern = path.join(sessionDir, 'seg_%05d.ts');
    const hlsFlags = [
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '60', // ~2-minute live timeshift buffer (pause & rewind!)
      '-hls_flags',
      'delete_segments+append_list+independent_segments',
      '-hls_segment_filename',
      segmentPattern,
      playlistFile,
    ];

    if (isVirtual) {
      return [
        '-y',
        '-hide_banner',
        '-loglevel',
        'warning',
        ...buildVirtualFfmpegInputArgs(channel, undefined, false),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-g',
        '60',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        ...hlsFlags,
      ];
    }

    const codecArgs = transcode
      ? [
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-tune',
          'zerolatency',
          '-g',
          '60',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-ac',
          '2',
          '-b:a',
          '160k',
        ]
      : ['-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-b:a', '192k'];

    return [
      '-y',
      '-hide_banner',
      '-loglevel',
      'warning',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5',
      '-i',
      channel.streamUrl,
      ...codecArgs,
      ...hlsFlags,
    ];
  }
}
