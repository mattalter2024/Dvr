import fs from 'node:fs';
import { v4 as uuid } from 'uuid';
import type { DvrDatabase } from '../db/database.js';
import type { TunerPool } from '../tuners/tunerPool.js';
import type { DvrRecorder } from './recorder.js';
import type { Program, Recording, SeriesPass } from '../types/index.js';

export class DvrScheduler {
  private tickTimer: NodeJS.Timeout | null = null;
  private onUpdated?: () => void;

  constructor(
    private db: DvrDatabase,
    private tunerPool: TunerPool,
    private recorder: DvrRecorder,
    onUpdated?: () => void,
  ) {
    this.onUpdated = onUpdated;
  }

  start(): void {
    this.stop();
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, 5000);
    void this.tick();
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Schedules a single program from the EPG.
   */
  scheduleProgram(
    programId: string,
    opts?: { paddingStartMin?: number; paddingEndMin?: number; seriesPassId?: string | null },
  ): Recording {
    const existing = this.db.findRecordingByProgramId(programId);
    if (existing) {
      return existing;
    }

    const program = this.db.getProgram(programId);
    if (!program) {
      throw new Error(`Program ${programId} not found`);
    }
    const channel = this.db.getChannel(program.channelId);
    if (!channel) {
      throw new Error(`Channel ${program.channelId} not found`);
    }

    const settings = this.db.getSettings();
    const rec: Recording = {
      id: uuid(),
      programId: program.id,
      seriesPassId: opts?.seriesPassId ?? null,
      channelId: channel.id,
      channelNumber: channel.guideNumber,
      channelName: channel.guideName,
      title: program.title,
      subtitle: program.subtitle,
      description: program.description,
      episodeNum: program.episodeNum,
      category: program.category,
      scheduledStart: program.startTime,
      scheduledEnd: program.endTime,
      actualStart: null,
      actualEnd: null,
      paddingStartMin: opts?.paddingStartMin ?? settings.defaultPaddingStartMin,
      paddingEndMin: opts?.paddingEndMin ?? settings.defaultPaddingEndMin,
      status: 'scheduled',
      errorMessage: null,
      filePath: null,
      fileSizeBytes: 0,
      durationSec: 0,
      thumbnailPath: null,
      commercialScanStatus: 'pending',
      commercialCount: 0,
      watchedPositionSec: 0,
      watched: false,
      createdAt: new Date().toISOString(),
    };

    this.db.insertRecording(rec);
    this.evaluateConflicts();
    this.onUpdated?.();
    void this.tick();
    return this.db.getRecording(rec.id) ?? rec;
  }

  /**
   * Starts an immediate ad-hoc / quick test recording on any channel (great for instant capture
   * or verifying commercial skipping with a 60-second recording!).
   */
  async recordNow(
    channelId: string,
    durationMinutes = 30,
    customTitle?: string,
  ): Promise<Recording> {
    const channel = this.db.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const now = new Date();
    const end = new Date(now.getTime() + Math.max(1, durationMinutes) * 60 * 1000);
    // Try to pull current EPG program title if no custom title provided
    const currentProgs = this.db.queryProgramsInRange(now.toISOString(), end.toISOString(), channelId);
    const current: Program | undefined = currentProgs[0];

    const rec: Recording = {
      id: uuid(),
      programId: current?.id ?? null,
      seriesPassId: null,
      channelId: channel.id,
      channelNumber: channel.guideNumber,
      channelName: channel.guideName,
      title: customTitle?.trim() || current?.title || `${channel.guideName} Live Capture`,
      subtitle: current?.subtitle ?? `Manual Recording (${durationMinutes}m)`,
      description: current?.description ?? `Instant OTA DVR capture from ${channel.guideNumber} ${channel.guideName}.`,
      episodeNum: current?.episodeNum ?? null,
      category: current?.category ?? 'Live Capture',
      scheduledStart: now.toISOString(),
      scheduledEnd: end.toISOString(),
      actualStart: null,
      actualEnd: null,
      paddingStartMin: 0,
      paddingEndMin: 0,
      status: 'scheduled',
      errorMessage: null,
      filePath: null,
      fileSizeBytes: 0,
      durationSec: 0,
      thumbnailPath: null,
      commercialScanStatus: 'pending',
      commercialCount: 0,
      watchedPositionSec: 0,
      watched: false,
      createdAt: now.toISOString(),
    };

    this.db.insertRecording(rec);
    const started = await this.recorder.startRecording(rec);
    this.onUpdated?.();
    return started;
  }

  /**
   * Creates or updates a Series Pass and immediately schedules all matching upcoming EPG episodes.
   */
  createSeriesPass(input: {
    title: string;
    channelId?: string | null;
    newOnly?: boolean;
    paddingStartMin?: number;
    paddingEndMin?: number;
    keepLimit?: number;
    priority?: number;
  }): { seriesPass: SeriesPass; scheduledCount: number } {
    const settings = this.db.getSettings();
    const pass: SeriesPass = {
      id: uuid(),
      title: input.title.trim(),
      channelId: input.channelId ?? null,
      newOnly: input.newOnly ?? false,
      paddingStartMin: input.paddingStartMin ?? settings.defaultPaddingStartMin,
      paddingEndMin: input.paddingEndMin ?? settings.defaultPaddingEndMin,
      keepLimit: input.keepLimit ?? 0,
      priority: input.priority ?? 50,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    this.db.upsertSeriesPass(pass);
    const scheduledCount = this.applySeriesPass(pass);
    this.evaluateConflicts();
    this.onUpdated?.();
    return { seriesPass: pass, scheduledCount };
  }

  applyAllSeriesPasses(): number {
    let total = 0;
    for (const pass of this.db.listSeriesPasses()) {
      if (pass.enabled) {
        total += this.applySeriesPass(pass);
      }
    }
    this.evaluateConflicts();
    this.pruneKeepLimits();
    return total;
  }

  private applySeriesPass(pass: SeriesPass): number {
    const matches = this.db.getUpcomingProgramsByTitle(pass.title, pass.channelId, pass.newOnly);
    let scheduled = 0;
    for (const prog of matches) {
      if (this.db.findRecordingByProgramId(prog.id)) continue;
      this.scheduleProgram(prog.id, {
        paddingStartMin: pass.paddingStartMin,
        paddingEndMin: pass.paddingEndMin,
        seriesPassId: pass.id,
      });
      scheduled++;
    }
    return scheduled;
  }

  /**
   * Detects tuner-capacity conflicts among upcoming scheduled recordings.
   */
  evaluateConflicts(): void {
    const maxTuners = Math.max(1, this.tunerPool.getTotalEnabledTunerSlots());
    const upcoming = this.db
      .listRecordings(['scheduled', 'recording', 'conflict'])
      .sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart));

    for (const rec of upcoming) {
      if (rec.status === 'recording') continue;
      const startA = Date.parse(rec.scheduledStart) - rec.paddingStartMin * 60 * 1000;
      const endA = Date.parse(rec.scheduledEnd) + rec.paddingEndMin * 60 * 1000;

      // Count distinct channels overlapping this recording window
      const overlappingChannels = new Set<string>([rec.channelId]);
      for (const other of upcoming) {
        if (other.id === rec.id) continue;
        const startB = Date.parse(other.scheduledStart) - other.paddingStartMin * 60 * 1000;
        const endB = Date.parse(other.scheduledEnd) + other.paddingEndMin * 60 * 1000;
        if (startA < endB && endA > startB) {
          overlappingChannels.add(other.channelId);
        }
      }

      if (overlappingChannels.size > maxTuners) {
        if (rec.status !== 'conflict') {
          this.db.updateRecording(rec.id, {
            status: 'conflict',
            errorMessage: `Tuner conflict: ${overlappingChannels.size} channels overlap (${maxTuners} tuner slots available)`,
          });
        }
      } else if (rec.status === 'conflict') {
        this.db.updateRecording(rec.id, { status: 'scheduled', errorMessage: null });
      }
    }
  }

  /**
   * Enforces Series Pass `keepLimit` by deleting oldest watched/completed episodes above the limit.
   */
  pruneKeepLimits(): void {
    const passes = this.db.listSeriesPasses().filter((p) => p.keepLimit > 0);
    const completed = this.db.listRecordings(['completed']);
    for (const pass of passes) {
      const episodes = completed
        .filter((r) => r.seriesPassId === pass.id)
        .sort((a, b) => Date.parse(b.scheduledStart) - Date.parse(a.scheduledStart));
      if (episodes.length <= pass.keepLimit) continue;
      const toDelete = episodes.slice(pass.keepLimit);
      for (const rec of toDelete) {
        if (rec.filePath && fs.existsSync(rec.filePath)) {
          try {
            fs.unlinkSync(rec.filePath);
          } catch {
            // ignore unlink errors
          }
        }
        this.db.deleteRecording(rec.id);
      }
    }
  }

  private async tick(): Promise<void> {
    const nowMs = Date.now();
    const scheduled = this.db.listRecordings(['scheduled']);

    for (const rec of scheduled) {
      const startMs = Date.parse(rec.scheduledStart) - rec.paddingStartMin * 60 * 1000;
      const endMs = Date.parse(rec.scheduledEnd) + rec.paddingEndMin * 60 * 1000;

      if (nowMs >= endMs) {
        this.db.updateRecording(rec.id, {
          status: 'failed',
          errorMessage: 'Missed scheduled air window',
        });
        continue;
      }

      if (nowMs >= startMs && !this.recorder.isRecording(rec.id)) {
        await this.recorder.startRecording(rec);
      }
    }
  }
}
