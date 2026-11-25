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
   * Multiple TVs watching the same channel share a single tuner slot and FFmpeg pipeline.
   */
  async startOrJoinChannel(channelId: string): Promise<LiveSession> {
    this.db.recordChannelWatch(channelId);

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
        caps.hwEncoder,
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

    // Wait until the first actual HLS segment (#EXTINF:) is written atomically so playback starts cleanly
    if (child) {
      await this.waitForPlaylistReady(playlistFile, 8000);
    }

    return info;
  }

  leaveSession(sessionId: string): void {
    const sess = this.sessionsById.get(sessionId);
    if (!sess) return;
    sess.info.viewerCount = Math.max(0, sess.info.viewerCount - 1);
    if (sess.info.viewerCount === 0) {
      // Short 15-second grace period for fast channel zapping / reload
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

  private waitForPlaylistReady(playlistFile: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        try {
          if (fs.existsSync(playlistFile)) {
            const content = fs.readFileSync(playlistFile, 'utf8');
            if (content.includes('#EXTINF:')) {
              resolve();
              return;
            }
          }
        } catch {
          // ignore transient atomic rename read race
        }
        if (Date.now() - start >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 120);
      };
      check();
    });
  }

  private buildVideoCodecArgs(transcode: boolean, hwEncoder: string | null): string[] {
    if (!transcode) {
      return ['-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-b:a', '192k'];
    }

    // Use GPU hardware H.264 encoder when detected for ~70-90% lower CPU usage on multi-room streams
    if (hwEncoder === 'h264_nvenc') {
      return [
        '-c:v', 'h264_nvenc', '-preset', 'p2', '-tune', 'ull', '-rc', 'vbr', '-b:v', '6M',
        '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
      ];
    }
    if (hwEncoder === 'h264_qsv') {
      return [
        '-c:v', 'h264_qsv', '-preset', 'veryfast', '-b:v', '6M',
        '-g', '60', '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
      ];
    }
    if (hwEncoder === 'h264_amf') {
      return [
        '-c:v', 'h264_amf', '-quality', 'speed', '-b:v', '6M',
        '-g', '60', '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
      ];
    }
    if (hwEncoder === 'h264_videotoolbox') {
      return [
        '-c:v', 'h264_videotoolbox', '-realtime', '1', '-b:v', '6M',
        '-g', '60', '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
      ];
    }

    // Tuned low-latency software x264 fallback
    return [
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-crf', '22', '-maxrate', '6M', '-bufsize', '12M',
      '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
    ];
  }

  private buildLiveHlsFfmpegArgs(
    channel: Channel,
    sessionDir: string,
    playlistFile: string,
    isVirtual: boolean,
    transcode: boolean,
    hwEncoder: string | null,
  ): string[] {
    const segmentPattern = path.join(sessionDir, 'seg_%05d.ts');
    const hlsFlags = [
      '-f', 'hls',
      '-hls_init_time', '1', // Rapid 1-second initial segment for fast channel tune-in
      '-hls_time', '2',
      '-hls_list_size', '60', // ~2-minute live timeshift pause/rewind buffer
      '-hls_flags', 'delete_segments+append_list+independent_segments+temp_file',
      '-hls_segment_filename', segmentPattern,
      playlistFile,
    ];

    if (isVirtual) {
      return [
        '-y',
        '-hide_banner',
        '-loglevel', 'warning',
        ...buildVirtualFfmpegInputArgs(channel, undefined, false),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-g', '60',
        '-sc_threshold', '0',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        ...hlsFlags,
      ];
    }

    return [
      '-y',
      '-hide_banner',
      '-loglevel', 'warning',
      '-fflags', '+genpts+discardcorrupt',
      '-analyzeduration', '1000000', // Fast 1s ATSC stream probe for snappy channel zapping
      '-probesize', '1000000',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '4',
      '-i', channel.streamUrl,
      ...this.buildVideoCodecArgs(transcode, hwEncoder),
      ...hlsFlags,
    ];
  }
}
