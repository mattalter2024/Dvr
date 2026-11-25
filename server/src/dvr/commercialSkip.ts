import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { v4 as uuid } from 'uuid';
import type { DvrDatabase } from '../db/database.js';
import type { CommercialSegment, DvrSettings, Recording } from '../types/index.js';
import { detectCapabilities } from '../config.js';

/**
 * Parses MPlayer/Comskip .edl format:
 *   <start_sec> <end_sec> <action>
 * Action 0 (cut) or 3 (commercial break) are treated as skippable commercials.
 */
export function parseEdlContent(
  content: string,
  recordingId: string,
  source: CommercialSegment['source'] = 'comskip',
): CommercialSegment[] {
  const segments: CommercialSegment[] = [];
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const startSec = Number.parseFloat(parts[0]);
    const endSec = Number.parseFloat(parts[1]);
    const action = parts.length >= 3 ? Number.parseInt(parts[2], 10) : 3;
    if (
      Number.isFinite(startSec) &&
      Number.isFinite(endSec) &&
      endSec > startSec &&
      (action === 0 || action === 3)
    ) {
      segments.push({
        id: uuid(),
        recordingId,
        startSec: Number(startSec.toFixed(2)),
        endSec: Number(endSec.toFixed(2)),
        confidence: source === 'comskip' ? 0.94 : 0.82,
        source,
      });
    }
  }
  return segments;
}

/**
 * Serializes commercial segments into standard Comskip/Kodi/MPlayer .edl format.
 */
export function serializeEdl(segments: CommercialSegment[]): string {
  return segments
    .slice()
    .sort((a, b) => a.startSec - b.startSec)
    .map((s) => `${s.startSec.toFixed(2)}\t${s.endSec.toFixed(2)}\t3`)
    .join('\n');
}

interface TimeRange {
  start: number;
  end: number;
}

/**
 * Pairs black-frame + audio-silence transition markers into commercial break spans.
 * Broadcast TV commercials are typically bracketed by brief black frames + silence dips,
 * lasting between 10 seconds (simulated/short promo) and 330 seconds (5.5-minute ad pod).
 */
export function inferCommercialsFromTransitions(
  blackRanges: TimeRange[],
  silenceRanges: TimeRange[],
  totalDurationSec: number,
  recordingId: string,
): CommercialSegment[] {
  // Prefer transitions where a black frame overlaps or is within 1.5s of a silence range
  const transitionPoints: number[] = [];

  for (const b of blackRanges) {
    const mid = (b.start + b.end) / 2;
    const hasSilence =
      silenceRanges.length === 0 ||
      silenceRanges.some((s) => s.start <= b.end + 1.5 && s.end >= b.start - 1.5);
    if (hasSilence) {
      if (transitionPoints.length === 0 || mid - transitionPoints[transitionPoints.length - 1] > 4) {
        transitionPoints.push(mid);
      }
    }
  }

  const segments: CommercialSegment[] = [];
  let i = 0;
  while (i < transitionPoints.length - 1) {
    const start = transitionPoints[i];
    const end = transitionPoints[i + 1];
    const span = end - start;

    // Valid ad break duration window: 10s .. 330s
    if (span >= 10 && span <= 330) {
      segments.push({
        id: uuid(),
        recordingId,
        startSec: Number(Math.max(0, start).toFixed(2)),
        endSec: Number(Math.min(totalDurationSec || end, end).toFixed(2)),
        confidence: 0.85,
        source: 'ffmpeg',
      });
      i += 2; // Jump past the closing transition of this commercial break
    } else {
      i += 1;
    }
  }

  return segments;
}

export class CommercialSkipService {
  private onScanned?: (recordingId: string, segments: CommercialSegment[]) => void;

  constructor(
    private db: DvrDatabase,
    onScanned?: (recordingId: string, segments: CommercialSegment[]) => void,
  ) {
    this.onScanned = onScanned;
  }

  async scanRecording(recordingId: string): Promise<CommercialSegment[]> {
    const recording = this.db.getRecording(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    this.db.updateRecording(recordingId, { commercialScanStatus: 'scanning' });
    const settings = this.db.getSettings();
    const caps = detectCapabilities(settings);

    try {
      let segments: CommercialSegment[] = [];

      const hasMediaFile = Boolean(recording.filePath && fs.existsSync(recording.filePath));

      if (hasMediaFile && recording.filePath) {
        // 1. Check if a pre-existing .edl file already sits beside the recording
        const edlPath = recording.filePath.replace(/\.[^.]+$/, '.edl');

        if (caps.comskipAvailable) {
          segments = await this.runComskip(recording, settings, edlPath);
        }

        // 2. Fallback to built-in FFmpeg blackdetect + silencedetect commercial analyzer
        if (segments.length === 0 && caps.ffmpegAvailable) {
          segments = await this.runFfmpegAnalyzer(recording, settings);
          if (segments.length > 0) {
            fs.writeFileSync(edlPath, serializeEdl(segments), 'utf8');
          }
        }
      }

      // 3. For simulated recordings without a media binary (or short virtual demo clips),
      //    generate realistic commercial breaks if none were detected from raw frames.
      if (segments.length === 0 && (!hasMediaFile || recording.channelId.startsWith('virtual-'))) {
        segments = this.generateDemoCommercials(recording);
      }

      this.db.replaceCommercials(recordingId, segments);
      this.onScanned?.(recordingId, segments);
      return segments;
    } catch (err) {
      console.error(`[Comskip] Scan failed for ${recordingId}:`, err);
      this.db.updateRecording(recordingId, { commercialScanStatus: 'failed' });
      throw err;
    }
  }

  private runComskip(
    recording: Recording,
    settings: DvrSettings,
    edlPath: string,
  ): Promise<CommercialSegment[]> {
    return new Promise((resolve) => {
      const filePath = recording.filePath!;
      const outDir = path.dirname(filePath);
      const args: string[] = [];
      if (settings.comskipIniPath && fs.existsSync(settings.comskipIniPath)) {
        args.push(`--ini=${settings.comskipIniPath}`);
      }
      args.push(`--output=${outDir}`, filePath);

      const child = spawn(settings.comskipPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('error', () => resolve([]));
      child.on('close', () => {
        if (fs.existsSync(edlPath)) {
          const content = fs.readFileSync(edlPath, 'utf8');
          resolve(parseEdlContent(content, recording.id, 'comskip'));
        } else {
          resolve([]);
        }
      });
    });
  }

  private runFfmpegAnalyzer(
    recording: Recording,
    settings: DvrSettings,
  ): Promise<CommercialSegment[]> {
    return new Promise((resolve) => {
      const filePath = recording.filePath!;
      const args = [
        '-hide_banner',
        '-i',
        filePath,
        '-vf',
        'blackdetect=d=0.4:pix_th=0.12',
        '-af',
        'silencedetect=noise=-35dB:d=0.4',
        '-f',
        'null',
        '-',
      ];

      const child = spawn(settings.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', () => resolve([]));
      child.on('close', () => {
        const blackRanges: TimeRange[] = [];
        const blackRe = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
        let m: RegExpExecArray | null;
        while ((m = blackRe.exec(stderr)) !== null) {
          blackRanges.push({ start: Number.parseFloat(m[1]), end: Number.parseFloat(m[2]) });
        }

        const silenceRanges: TimeRange[] = [];
        let pendingSilenceStart: number | null = null;
        for (const line of stderr.split(/\r?\n/)) {
          const startMatch = line.match(/silence_start:\s*([\d.]+)/);
          if (startMatch) {
            pendingSilenceStart = Number.parseFloat(startMatch[1]);
          }
          const endMatch = line.match(/silence_end:\s*([\d.]+)/);
          if (endMatch && pendingSilenceStart !== null) {
            silenceRanges.push({
              start: pendingSilenceStart,
              end: Number.parseFloat(endMatch[1]),
            });
            pendingSilenceStart = null;
          }
        }

        const segments = inferCommercialsFromTransitions(
          blackRanges,
          silenceRanges,
          recording.durationSec,
          recording.id,
        );
        resolve(segments);
      });
    });
  }

  private generateDemoCommercials(recording: Recording): CommercialSegment[] {
    const duration = Math.max(60, recording.durationSec || 1800);
    if (duration <= 180) {
      // Short test clip: place a 15-second commercial break at 28s..43s (matching virtual tuner!)
      const segs: CommercialSegment[] = [];
      for (let t = 28; t + 15 < duration; t += 45) {
        segs.push({
          id: uuid(),
          recordingId: recording.id,
          startSec: t,
          endSec: t + 15,
          confidence: 0.91,
          source: 'synthetic',
        });
      }
      return segs;
    }

    // Standard 30-min / 60-min broadcast pattern: ad pods every ~10 minutes lasting ~2m15s
    const segs: CommercialSegment[] = [];
    for (let t = 480; t + 135 < duration - 120; t += 660) {
      segs.push({
        id: uuid(),
        recordingId: recording.id,
        startSec: t,
        endSec: t + 135,
        confidence: 0.92,
        source: 'synthetic',
      });
    }
    return segs;
  }
}
