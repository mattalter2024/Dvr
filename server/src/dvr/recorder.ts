import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { envConfig, detectCapabilities } from '../config.js';
import type { DvrDatabase } from '../db/database.js';
import type { TunerPool } from '../tuners/tunerPool.js';
import { buildVirtualFfmpegInputArgs } from '../tuners/virtualTuner.js';
import type { CommercialSkipService } from './commercialSkip.js';
import type { Channel, Recording } from '../types/index.js';

interface ActiveCapture {
  recordingId: string;
  leaseId: string;
  process: ChildProcess | null;
  stopTimer: NodeJS.Timeout | null;
  progressTimer: NodeJS.Timeout | null;
  startedAtMs: number;
  filePath: string | null;
  simulated: boolean;
}

function sanitizeFilename(input: string): string {
  return input
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export class DvrRecorder {
  private active = new Map<string, ActiveCapture>();
  private onEvent?: (type: 'recording_started' | 'recording_progress' | 'recording_completed' | 'recording_failed', payload: unknown) => void;

  constructor(
    private db: DvrDatabase,
    private tunerPool: TunerPool,
    private commercialSkip: CommercialSkipService,
    onEvent?: (
      type: 'recording_started' | 'recording_progress' | 'recording_completed' | 'recording_failed',
      payload: unknown,
    ) => void,
  ) {
    this.onEvent = onEvent;
  }

  isRecording(recordingId: string): boolean {
    return this.active.has(recordingId);
  }

  getActiveRecordingIds(): string[] {
    return Array.from(this.active.keys());
  }

  async startRecording(recording: Recording): Promise<Recording> {
    if (this.active.has(recording.id)) {
      return recording;
    }

    const channel = this.db.getChannel(recording.channelId);
    if (!channel) {
      const failed = this.db.updateRecording(recording.id, {
        status: 'failed',
        errorMessage: `Channel ${recording.channelId} not found`,
      })!;
      this.onEvent?.('recording_failed', failed);
      return failed;
    }

    let leaseId: string;
    try {
      const lease = this.tunerPool.acquire(channel, 'recording', recording.id);
      leaseId = lease.id;
    } catch (err) {
      const failed = this.db.updateRecording(recording.id, {
        status: 'conflict',
        errorMessage: err instanceof Error ? err.message : 'No available tuner',
      })!;
      this.onEvent?.('recording_failed', failed);
      return failed;
    }

    const settings = this.db.getSettings();
    const caps = detectCapabilities(settings);
    const nowMs = Date.now();
    const paddedEndMs = Date.parse(recording.scheduledEnd) + recording.paddingEndMin * 60 * 1000;
    const durationSec = Math.max(15, Math.ceil((paddedEndMs - nowMs) / 1000));

    const showDir = path.join(envConfig.recordingsDir, sanitizeFilename(recording.title || 'Show'));
    fs.mkdirSync(showDir, { recursive: true });
    const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const epTag = recording.episodeNum ? ` - ${sanitizeFilename(recording.episodeNum)}` : '';
    const filePath = path.join(
      showDir,
      `${sanitizeFilename(recording.title)}${epTag} [${stamp}].mp4`,
    );

    const updated = this.db.updateRecording(recording.id, {
      status: 'recording',
      actualStart: new Date(nowMs).toISOString(),
      filePath: caps.ffmpegAvailable ? filePath : null,
      errorMessage: null,
    })!;

    this.onEvent?.('recording_started', updated);

    if (!caps.ffmpegAvailable) {
      // Simulated capture mode when FFmpeg is not yet installed on host
      const capture: ActiveCapture = {
        recordingId: recording.id,
        leaseId,
        process: null,
        stopTimer: null,
        progressTimer: null,
        startedAtMs: nowMs,
        filePath: null,
        simulated: true,
      };
      this.active.set(recording.id, capture);

      capture.progressTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - capture.startedAtMs) / 1000);
        const rec = this.db.updateRecording(recording.id, {
          durationSec: elapsed,
          fileSizeBytes: elapsed * 650_000, // ~5.2 Mbps ATSC estimate
        });
        if (rec) this.onEvent?.('recording_progress', rec);
      }, 3000);

      capture.stopTimer = setTimeout(() => {
        void this.finishCapture(recording.id, true);
      }, durationSec * 1000);

      return updated;
    }

    const isVirtual = channel.streamUrl.startsWith('virtual://');
    const args = this.buildFfmpegArgs(channel, filePath, durationSec, isVirtual);
    const child = spawn(settings.ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });

    const capture: ActiveCapture = {
      recordingId: recording.id,
      leaseId,
      process: child,
      stopTimer: null,
      progressTimer: null,
      startedAtMs: nowMs,
      filePath,
      simulated: false,
    };
    this.active.set(recording.id, capture);

    capture.progressTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - capture.startedAtMs) / 1000);
      let fileSizeBytes = 0;
      try {
        if (fs.existsSync(filePath)) {
          fileSizeBytes = fs.statSync(filePath).size;
        }
      } catch {
        // ignore transient stat errors
      }
      const rec = this.db.updateRecording(recording.id, {
        durationSec: elapsed,
        fileSizeBytes,
      });
      if (rec) this.onEvent?.('recording_progress', rec);
    }, 3000);

    // Safety hard-stop slightly past target duration
    capture.stopTimer = setTimeout(() => {
      this.stopRecording(recording.id);
    }, (durationSec + 10) * 1000);

    let lastErrorLine = '';
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) lastErrorLine = text.split(/\r?\n/).slice(-1)[0] ?? lastErrorLine;
    });

    child.on('error', (err) => {
      void this.finishCapture(recording.id, false, err.message);
    });

    child.on('close', (code) => {
      if (!this.active.has(recording.id)) return;
      const ok = code === 0 || code === 255 || (fs.existsSync(filePath) && fs.statSync(filePath).size > 10_000);
      void this.finishCapture(recording.id, ok, ok ? undefined : lastErrorLine || `FFmpeg exited with code ${code}`);
    });

    return updated;
  }

  private buildFfmpegArgs(
    channel: Channel,
    outputFile: string,
    durationSec: number,
    isVirtual: boolean,
  ): string[] {
    if (isVirtual) {
      return [
        '-y',
        '-hide_banner',
        '-loglevel',
        'warning',
        ...buildVirtualFfmpegInputArgs(channel, durationSec, true),
        '-t',
        String(durationSec),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+frag_keyframe+empty_moov+faststart',
        outputFile,
      ];
    }

    // Real HDHomeRun ATSC MPEG-TS capture -> fragmented MP4 (allows chase-play while recording!)
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
      '-t',
      String(durationSec),
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-b:a',
      '192k',
      '-movflags',
      '+frag_keyframe+empty_moov+faststart',
      outputFile,
    ];
  }

  stopRecording(recordingId: string): boolean {
    const capture = this.active.get(recordingId);
    if (!capture) return false;

    if (capture.simulated || !capture.process) {
      void this.finishCapture(recordingId, true);
      return true;
    }

    // Ask FFmpeg to gracefully finalize the MP4 container
    try {
      capture.process.stdin?.write('q\n');
    } catch {
      capture.process.kill('SIGTERM');
    }

    // Force kill if it hasn't exited within 4 seconds
    setTimeout(() => {
      if (this.active.has(recordingId)) {
        try {
          capture.process?.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }, 4000);
    return true;
  }

  private async finishCapture(
    recordingId: string,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    const capture = this.active.get(recordingId);
    if (!capture) return;
    this.active.delete(recordingId);

    if (capture.stopTimer) clearTimeout(capture.stopTimer);
    if (capture.progressTimer) clearInterval(capture.progressTimer);
    this.tunerPool.release(capture.leaseId);

    const elapsedSec = Math.max(1, Math.round((Date.now() - capture.startedAtMs) / 1000));
    const settings = this.db.getSettings();
    let fileSizeBytes = 0;
    let durationSec = elapsedSec;
    let thumbnailPath: string | null = null;

    if (capture.filePath && fs.existsSync(capture.filePath)) {
      fileSizeBytes = fs.statSync(capture.filePath).size;
      const probed = this.probeDuration(capture.filePath, settings.ffprobePath);
      if (probed) durationSec = probed;
      thumbnailPath = this.extractThumbnail(recordingId, capture.filePath, settings.ffmpegPath);
    } else if (capture.simulated) {
      fileSizeBytes = elapsedSec * 650_000;
    }

    const updated = this.db.updateRecording(recordingId, {
      status: success ? 'completed' : 'failed',
      actualEnd: new Date().toISOString(),
      durationSec,
      fileSizeBytes,
      thumbnailPath,
      errorMessage: success ? null : errorMessage ?? 'Recording failed',
    });

    if (!updated) return;

    if (success) {
      this.onEvent?.('recording_completed', updated);
      if (settings.autoCommercialScan) {
        this.commercialSkip.scanRecording(recordingId).catch((err) => {
          console.error(`[DVR] Auto commercial scan failed for ${recordingId}:`, err);
        });
      }
    } else {
      this.onEvent?.('recording_failed', updated);
    }
  }

  private probeDuration(filePath: string, ffprobePath: string): number | null {
    try {
      const out = execFileSync(
        ffprobePath,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
        { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const val = Number.parseFloat(out.trim());
      return Number.isFinite(val) && val > 0 ? Math.round(val) : null;
    } catch {
      return null;
    }
  }

  private extractThumbnail(recordingId: string, filePath: string, ffmpegPath: string): string | null {
    try {
      const thumbPath = path.join(envConfig.thumbnailsDir, `${recordingId}.jpg`);
      execFileSync(
        ffmpegPath,
        ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '00:00:03', '-i', filePath, '-vframes', '1', '-q:v', '4', thumbPath],
        { timeout: 8000, stdio: 'ignore' },
      );
      return fs.existsSync(thumbPath) ? thumbPath : null;
    } catch {
      return null;
    }
  }

  stopAll(): void {
    for (const id of Array.from(this.active.keys())) {
      this.stopRecording(id);
    }
  }
}
