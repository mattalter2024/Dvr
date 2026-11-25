import fs from 'node:fs';
import path from 'node:path';
import { envConfig } from '../config.js';
import type { DvrDatabase } from '../db/database.js';
import type { CleanupReport, Recording } from '../types/index.js';

const DAY_MS = 24 * 3600 * 1000;

function removeRecordingFiles(rec: Recording): number {
  let freed = 0;
  const targets: string[] = [];
  if (rec.filePath) {
    targets.push(
      rec.filePath,
      rec.filePath.replace(/\.[^.]+$/, '.edl'),
      rec.filePath.replace(/\.[^.]+$/, '.txt'),
      rec.filePath.replace(/\.[^.]+$/, '.log'),
    );
  }
  if (rec.thumbnailPath) {
    targets.push(rec.thumbnailPath);
  }

  for (const file of targets) {
    if (!fs.existsSync(file)) continue;
    try {
      const size = fs.statSync(file).size;
      fs.unlinkSync(file);
      freed += size;
    } catch {
      // ignore transient unlink errors
    }
  }

  // Remove empty parent show folder inside recordingsDir if now empty
  if (rec.filePath) {
    const parent = path.dirname(rec.filePath);
    if (parent !== envConfig.recordingsDir && fs.existsSync(parent)) {
      try {
        if (fs.readdirSync(parent).length === 0) {
          fs.rmdirSync(parent);
        }
      } catch {
        // ignore
      }
    }
  }

  return freed || rec.fileSizeBytes || 0;
}

export class DvrCleanupService {
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private lastReport: CleanupReport | null = null;
  private onCleaned?: (report: CleanupReport) => void;

  constructor(private db: DvrDatabase, onCleaned?: (report: CleanupReport) => void) {
    this.onCleaned = onCleaned;
  }

  start(): void {
    this.stop();
    const hours = Math.max(1, this.db.getSettings().cleanupIntervalHours || 6);
    this.timer = setInterval(() => {
      this.runCleanup(false);
    }, hours * 3600 * 1000);

    // Run a gentle startup sweep 30s after server boot
    this.startupTimer = setTimeout(() => {
      this.runCleanup(false);
    }, 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  getStatus() {
    const completed = this.db.listRecordings(['completed', 'recording']);
    const totalRecordingsBytes = completed.reduce((acc, r) => acc + (r.fileSizeBytes || 0), 0);
    const protectedCount = completed.filter((r) => r.keepProtected || r.keepDays === 0).length;
    const preview = this.runCleanup(true);
    return {
      totalRecordingsBytes,
      totalRecordingsCount: completed.length,
      protectedCount,
      maxStorageGb: this.db.getSettings().maxStorageGb,
      cleanupIntervalHours: this.db.getSettings().cleanupIntervalHours,
      lastReport: this.lastReport,
      preview,
    };
  }

  /**
   * Executes the 4-stage DVR cleanup sweep:
   *  1. Expired recordings past their `keepDays` retention window (skipping protected / Keep Forever)
   *  2. Watched recordings older than `deleteWatchedAfterDays`
   *  3. Storage quota enforcement (`maxStorageGb`, removing oldest watched then oldest unwatched)
   *  4. Stale HLS temp folders, orphaned thumbnails, and old failed/cancelled DB rows
   */
  runCleanup(dryRun = false, nowMs = Date.now()): CleanupReport {
    const settings = this.db.getSettings();
    const allRecordings = this.db.listRecordings();
    const completed = allRecordings.filter((r) => r.status === 'completed');

    let expiredDeleted = 0;
    let watchedDeleted = 0;
    let quotaDeleted = 0;
    let orphansRemoved = 0;
    let bytesFreed = 0;

    const deletedIds = new Set<string>();

    const evict = (rec: Recording, reason: 'expired' | 'watched' | 'quota') => {
      deletedIds.add(rec.id);
      if (reason === 'expired') expiredDeleted++;
      else if (reason === 'watched') watchedDeleted++;
      else quotaDeleted++;

      if (dryRun) {
        bytesFreed += rec.fileSizeBytes || 0;
      } else {
        bytesFreed += removeRecordingFiles(rec);
        this.db.deleteRecording(rec.id);
      }
    };

    // Stage 1 & 2: Retention expiry + Watched auto-delete
    for (const rec of completed) {
      if (rec.keepProtected) continue;
      const recordedAtMs = Date.parse(rec.actualEnd ?? rec.scheduledEnd ?? rec.createdAt);
      if (Number.isNaN(recordedAtMs)) continue;
      const ageDays = (nowMs - recordedAtMs) / DAY_MS;

      if (rec.keepDays > 0 && ageDays >= rec.keepDays) {
        evict(rec, 'expired');
        continue;
      }

      if (
        rec.watched &&
        settings.deleteWatchedAfterDays > 0 &&
        ageDays >= settings.deleteWatchedAfterDays
      ) {
        evict(rec, 'watched');
      }
    }

    // Stage 3: Storage quota enforcement (maxStorageGb > 0)
    if (settings.maxStorageGb > 0) {
      const quotaBytes = settings.maxStorageGb * 1024 * 1024 * 1024;
      const remaining = completed.filter((r) => !deletedIds.has(r.id));
      let usedBytes = remaining.reduce((acc, r) => acc + (r.fileSizeBytes || 0), 0);

      if (usedBytes > quotaBytes) {
        // Evict oldest unprotected recordings: watched first, then unwatched
        const candidates = remaining
          .filter((r) => !r.keepProtected && r.keepDays !== 0)
          .sort((a, b) => {
            if (a.watched !== b.watched) return a.watched ? -1 : 1;
            const timeA = Date.parse(a.actualEnd ?? a.scheduledEnd ?? a.createdAt);
            const timeB = Date.parse(b.actualEnd ?? b.scheduledEnd ?? b.createdAt);
            return timeA - timeB;
          });

        for (const rec of candidates) {
          if (usedBytes <= quotaBytes) break;
          usedBytes -= rec.fileSizeBytes || 0;
          evict(rec, 'quota');
        }
      }
    }

    // Stage 4: Stale HLS temp folders (>2h old), orphaned thumbnails, and old failed/cancelled rows (>14d)
    const activeIds = new Set(allRecordings.filter((r) => !deletedIds.has(r.id)).map((r) => r.id));

    for (const rec of allRecordings) {
      if (rec.status === 'failed' || rec.status === 'cancelled') {
        const ts = Date.parse(rec.scheduledEnd ?? rec.createdAt);
        if (!Number.isNaN(ts) && nowMs - ts >= 14 * DAY_MS) {
          orphansRemoved++;
          if (!dryRun) {
            removeRecordingFiles(rec);
            this.db.deleteRecording(rec.id);
          }
        }
      }
    }

    if (fs.existsSync(envConfig.thumbnailsDir)) {
      for (const file of fs.readdirSync(envConfig.thumbnailsDir)) {
        const recId = file.replace(/\.[^.]+$/, '');
        if (!activeIds.has(recId)) {
          const full = path.join(envConfig.thumbnailsDir, file);
          try {
            const size = fs.statSync(full).size;
            orphansRemoved++;
            bytesFreed += size;
            if (!dryRun) fs.unlinkSync(full);
          } catch {
            // ignore
          }
        }
      }
    }

    if (fs.existsSync(envConfig.hlsDir)) {
      for (const entry of fs.readdirSync(envConfig.hlsDir)) {
        const full = path.join(envConfig.hlsDir, entry);
        try {
          const stat = fs.statSync(full);
          if (nowMs - stat.mtimeMs > 2 * 3600 * 1000) {
            orphansRemoved++;
            if (!dryRun) fs.rmSync(full, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
    }

    const remainingCompleted = completed.filter((r) => !deletedIds.has(r.id));
    const report: CleanupReport = {
      ranAt: new Date(nowMs).toISOString(),
      dryRun,
      expiredDeleted,
      watchedDeleted,
      quotaDeleted,
      orphansRemoved,
      bytesFreed,
      totalRecordingsBytes: remainingCompleted.reduce((acc, r) => acc + (r.fileSizeBytes || 0), 0),
      totalRecordingsCount: remainingCompleted.length,
      protectedCount: remainingCompleted.filter((r) => r.keepProtected || r.keepDays === 0).length,
    };

    if (!dryRun) {
      this.lastReport = report;
      if (expiredDeleted + watchedDeleted + quotaDeleted + orphansRemoved > 0) {
        this.onCleaned?.(report);
      }
    }

    return report;
  }
}
