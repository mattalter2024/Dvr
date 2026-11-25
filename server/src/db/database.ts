import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { DEFAULT_SETTINGS, envConfig } from '../config.js';
import type {
  Channel,
  CommercialSegment,
  DvrSettings,
  Program,
  Recording,
  SeriesPass,
  StreamingApp,
  TunerDevice,
} from '../types/index.js';

export class DvrDatabase {
  private db!: Database;
  private dbPath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(dbPath = path.join(envConfig.dataDir, 'airvault.sqlite')) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }
    this.createSchema();
    this.flushNow();
  }

  private createSchema(): void {
    this.db.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS tuners (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        host TEXT NOT NULL,
        device_id TEXT NOT NULL,
        model_number TEXT NOT NULL,
        tuner_count INTEGER NOT NULL DEFAULT 2,
        base_url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        tuner_id TEXT NOT NULL,
        guide_number TEXT NOT NULL,
        guide_name TEXT NOT NULL,
        network TEXT NOT NULL DEFAULT '',
        stream_url TEXT NOT NULL,
        logo_url TEXT,
        xmltv_id TEXT,
        hd INTEGER NOT NULL DEFAULT 1,
        favorite INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (tuner_id) REFERENCES tuners(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_channels_guide_number ON channels(guide_number);

      CREATE TABLE IF NOT EXISTS programs (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        episode_num TEXT,
        series_id TEXT,
        poster_url TEXT,
        is_new INTEGER NOT NULL DEFAULT 0,
        is_live INTEGER NOT NULL DEFAULT 0,
        rating TEXT,
        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_programs_channel_time ON programs(channel_id, start_time, end_time);
      CREATE INDEX IF NOT EXISTS idx_programs_title ON programs(title);

      CREATE TABLE IF NOT EXISTS series_passes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        channel_id TEXT,
        new_only INTEGER NOT NULL DEFAULT 0,
        padding_start_min INTEGER NOT NULL DEFAULT 1,
        padding_end_min INTEGER NOT NULL DEFAULT 2,
        keep_limit INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 50,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        program_id TEXT,
        series_pass_id TEXT,
        channel_id TEXT NOT NULL,
        channel_number TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        description TEXT,
        episode_num TEXT,
        category TEXT NOT NULL DEFAULT 'General',
        scheduled_start TEXT NOT NULL,
        scheduled_end TEXT NOT NULL,
        actual_start TEXT,
        actual_end TEXT,
        padding_start_min INTEGER NOT NULL DEFAULT 1,
        padding_end_min INTEGER NOT NULL DEFAULT 2,
        status TEXT NOT NULL DEFAULT 'scheduled',
        error_message TEXT,
        file_path TEXT,
        file_size_bytes INTEGER NOT NULL DEFAULT 0,
        duration_sec REAL NOT NULL DEFAULT 0,
        thumbnail_path TEXT,
        commercial_scan_status TEXT NOT NULL DEFAULT 'pending',
        commercial_count INTEGER NOT NULL DEFAULT 0,
        watched_position_sec REAL NOT NULL DEFAULT 0,
        watched INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status, scheduled_start);
      CREATE INDEX IF NOT EXISTS idx_recordings_title ON recordings(title);

      CREATE TABLE IF NOT EXISTS commercials (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        start_sec REAL NOT NULL,
        end_sec REAL NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.9,
        source TEXT NOT NULL DEFAULT 'comskip',
        FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_commercials_recording ON commercials(recording_id, start_sec);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS streaming_apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tagline TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Streaming',
        web_url TEXT NOT NULL,
        android_package TEXT NOT NULL DEFAULT '',
        fallback_android_package TEXT,
        brand_color TEXT NOT NULL DEFAULT '#334155',
        monogram TEXT NOT NULL DEFAULT 'TV',
        pinned INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 100
      );
    `);
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    // Coalesce frequent progress/heartbeat updates into a single atomic disk write every 1.5s
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushNow();
    }, 1500);
  }

  flushNow(): void {
    if (!this.db) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const data = this.db.export();
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, this.dbPath);
    this.dirty = false;
  }

  close(): void {
    if (this.dirty) {
      this.flushNow();
    }
    this.db?.close();
  }

  private run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params);
    this.scheduleSave();
  }

  private all<T>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  private get<T>(sql: string, params: SqlValue[] = []): T | null {
    const rows = this.all<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  // ==================== SETTINGS ====================

  getSettings(): DvrSettings {
    const rows = this.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      try {
        merged[row.key] = JSON.parse(row.value);
      } catch {
        merged[row.key] = row.value;
      }
    }
    return merged as unknown as DvrSettings;
  }

  updateSettings(partial: Partial<DvrSettings>): DvrSettings {
    for (const [key, value] of Object.entries(partial)) {
      if (value === undefined) continue;
      this.run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, JSON.stringify(value)],
      );
    }
    return this.getSettings();
  }

  // ==================== TUNERS ====================

  upsertTuner(tuner: TunerDevice): void {
    this.run(
      `INSERT INTO tuners (id, name, type, host, device_id, model_number, tuner_count, base_url, enabled, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         host = excluded.host,
         model_number = excluded.model_number,
         tuner_count = excluded.tuner_count,
         base_url = excluded.base_url,
         enabled = excluded.enabled,
         last_seen_at = excluded.last_seen_at`,
      [
        tuner.id,
        tuner.name,
        tuner.type,
        tuner.host,
        tuner.deviceId,
        tuner.modelNumber,
        tuner.tunerCount,
        tuner.baseUrl,
        tuner.enabled ? 1 : 0,
        tuner.lastSeenAt,
      ],
    );
  }

  listTuners(): TunerDevice[] {
    return this.all<Record<string, unknown>>('SELECT * FROM tuners ORDER BY type ASC, name ASC').map(
      (r) => ({
        id: String(r.id),
        name: String(r.name),
        type: String(r.type) as TunerDevice['type'],
        host: String(r.host),
        deviceId: String(r.device_id),
        modelNumber: String(r.model_number),
        tunerCount: Number(r.tuner_count),
        baseUrl: String(r.base_url),
        enabled: Number(r.enabled) === 1,
        lastSeenAt: String(r.last_seen_at),
      }),
    );
  }

  getTuner(id: string): TunerDevice | null {
    const r = this.get<Record<string, unknown>>('SELECT * FROM tuners WHERE id = ?', [id]);
    if (!r) return null;
    return {
      id: String(r.id),
      name: String(r.name),
      type: String(r.type) as TunerDevice['type'],
      host: String(r.host),
      deviceId: String(r.device_id),
      modelNumber: String(r.model_number),
      tunerCount: Number(r.tuner_count),
      baseUrl: String(r.base_url),
      enabled: Number(r.enabled) === 1,
      lastSeenAt: String(r.last_seen_at),
    };
  }

  deleteTuner(id: string): void {
    this.run('DELETE FROM tuners WHERE id = ?', [id]);
  }

  // ==================== CHANNELS ====================

  upsertChannel(channel: Channel): void {
    this.run(
      `INSERT INTO channels (id, tuner_id, guide_number, guide_name, network, stream_url, logo_url, xmltv_id, hd, favorite, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         guide_number = excluded.guide_number,
         guide_name = excluded.guide_name,
         network = excluded.network,
         stream_url = excluded.stream_url,
         logo_url = COALESCE(excluded.logo_url, channels.logo_url),
         xmltv_id = COALESCE(excluded.xmltv_id, channels.xmltv_id),
         hd = excluded.hd`,
      [
        channel.id,
        channel.tunerId,
        channel.guideNumber,
        channel.guideName,
        channel.network,
        channel.streamUrl,
        channel.logoUrl,
        channel.xmltvId,
        channel.hd ? 1 : 0,
        channel.favorite ? 1 : 0,
        channel.enabled ? 1 : 0,
      ],
    );
  }

  private mapChannel(r: Record<string, unknown>): Channel {
    return {
      id: String(r.id),
      tunerId: String(r.tuner_id),
      guideNumber: String(r.guide_number),
      guideName: String(r.guide_name),
      network: String(r.network ?? ''),
      streamUrl: String(r.stream_url),
      logoUrl: r.logo_url ? String(r.logo_url) : null,
      xmltvId: r.xmltv_id ? String(r.xmltv_id) : null,
      hd: Number(r.hd) === 1,
      favorite: Number(r.favorite) === 1,
      enabled: Number(r.enabled) === 1,
    };
  }

  listChannels(includeDisabled = false): Channel[] {
    const sql = includeDisabled
      ? 'SELECT * FROM channels ORDER BY CAST(guide_number AS REAL) ASC, guide_number ASC'
      : 'SELECT * FROM channels WHERE enabled = 1 ORDER BY CAST(guide_number AS REAL) ASC, guide_number ASC';
    return this.all<Record<string, unknown>>(sql).map((r) => this.mapChannel(r));
  }

  getChannel(id: string): Channel | null {
    const row = this.get<Record<string, unknown>>('SELECT * FROM channels WHERE id = ?', [id]);
    return row ? this.mapChannel(row) : null;
  }

  updateChannel(id: string, patch: Partial<Pick<Channel, 'favorite' | 'enabled' | 'xmltvId' | 'logoUrl'>>): Channel | null {
    const current = this.getChannel(id);
    if (!current) return null;
    this.run(
      `UPDATE channels SET favorite = ?, enabled = ?, xmltv_id = ?, logo_url = ? WHERE id = ?`,
      [
        patch.favorite !== undefined ? (patch.favorite ? 1 : 0) : current.favorite ? 1 : 0,
        patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : current.enabled ? 1 : 0,
        patch.xmltvId !== undefined ? patch.xmltvId : current.xmltvId,
        patch.logoUrl !== undefined ? patch.logoUrl : current.logoUrl,
        id,
      ],
    );
    return this.getChannel(id);
  }

  // ==================== PROGRAMS (EPG) ====================

  private mapProgram(r: Record<string, unknown>): Program {
    return {
      id: String(r.id),
      channelId: String(r.channel_id),
      title: String(r.title),
      subtitle: r.subtitle ? String(r.subtitle) : null,
      description: r.description ? String(r.description) : null,
      startTime: String(r.start_time),
      endTime: String(r.end_time),
      category: String(r.category ?? 'General'),
      episodeNum: r.episode_num ? String(r.episode_num) : null,
      seriesId: r.series_id ? String(r.series_id) : null,
      posterUrl: r.poster_url ? String(r.poster_url) : null,
      isNew: Number(r.is_new) === 1,
      isLive: Number(r.is_live) === 1,
      rating: r.rating ? String(r.rating) : null,
    };
  }

  replaceProgramsForChannels(channelIds: string[], programs: Program[]): void {
    this.db.run('BEGIN TRANSACTION');
    try {
      for (const chId of channelIds) {
        this.db.run('DELETE FROM programs WHERE channel_id = ?', [chId]);
      }
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO programs
         (id, channel_id, title, subtitle, description, start_time, end_time, category, episode_num, series_id, poster_url, is_new, is_live, rating)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of programs) {
        stmt.run([
          p.id,
          p.channelId,
          p.title,
          p.subtitle,
          p.description,
          p.startTime,
          p.endTime,
          p.category,
          p.episodeNum,
          p.seriesId,
          p.posterUrl,
          p.isNew ? 1 : 0,
          p.isLive ? 1 : 0,
          p.rating,
        ]);
      }
      stmt.free();
      this.db.run('COMMIT');
      this.scheduleSave();
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  getProgram(id: string): Program | null {
    const row = this.get<Record<string, unknown>>('SELECT * FROM programs WHERE id = ?', [id]);
    return row ? this.mapProgram(row) : null;
  }

  queryProgramsInRange(startIso: string, endIso: string, channelId?: string): Program[] {
    if (channelId) {
      return this.all<Record<string, unknown>>(
        `SELECT * FROM programs
         WHERE channel_id = ? AND end_time > ? AND start_time < ?
         ORDER BY start_time ASC`,
        [channelId, startIso, endIso],
      ).map((r) => this.mapProgram(r));
    }
    return this.all<Record<string, unknown>>(
      `SELECT * FROM programs
       WHERE end_time > ? AND start_time < ?
       ORDER BY channel_id ASC, start_time ASC`,
      [startIso, endIso],
    ).map((r) => this.mapProgram(r));
  }

  searchPrograms(query: string, limit = 50): Program[] {
    const like = `%${query.trim()}%`;
    return this.all<Record<string, unknown>>(
      `SELECT * FROM programs
       WHERE (title LIKE ? OR subtitle LIKE ? OR description LIKE ? OR category LIKE ?)
         AND end_time > ?
       ORDER BY start_time ASC
       LIMIT ?`,
      [like, like, like, like, new Date().toISOString(), limit],
    ).map((r) => this.mapProgram(r));
  }

  getUpcomingProgramsByTitle(title: string, channelId: string | null, newOnly: boolean): Program[] {
    const now = new Date().toISOString();
    const params: SqlValue[] = [title, now];
    let sql = `SELECT * FROM programs WHERE LOWER(title) = LOWER(?) AND end_time > ?`;
    if (channelId) {
      sql += ` AND channel_id = ?`;
      params.push(channelId);
    }
    if (newOnly) {
      sql += ` AND is_new = 1`;
    }
    sql += ` ORDER BY start_time ASC`;
    return this.all<Record<string, unknown>>(sql, params).map((r) => this.mapProgram(r));
  }

  // ==================== SERIES PASSES ====================

  private mapSeriesPass(r: Record<string, unknown>): SeriesPass {
    return {
      id: String(r.id),
      title: String(r.title),
      channelId: r.channel_id ? String(r.channel_id) : null,
      newOnly: Number(r.new_only) === 1,
      paddingStartMin: Number(r.padding_start_min),
      paddingEndMin: Number(r.padding_end_min),
      keepLimit: Number(r.keep_limit),
      priority: Number(r.priority),
      enabled: Number(r.enabled) === 1,
      createdAt: String(r.created_at),
    };
  }

  upsertSeriesPass(pass: SeriesPass): void {
    this.run(
      `INSERT INTO series_passes (id, title, channel_id, new_only, padding_start_min, padding_end_min, keep_limit, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         channel_id = excluded.channel_id,
         new_only = excluded.new_only,
         padding_start_min = excluded.padding_start_min,
         padding_end_min = excluded.padding_end_min,
         keep_limit = excluded.keep_limit,
         priority = excluded.priority,
         enabled = excluded.enabled`,
      [
        pass.id,
        pass.title,
        pass.channelId,
        pass.newOnly ? 1 : 0,
        pass.paddingStartMin,
        pass.paddingEndMin,
        pass.keepLimit,
        pass.priority,
        pass.enabled ? 1 : 0,
        pass.createdAt,
      ],
    );
  }

  listSeriesPasses(): SeriesPass[] {
    return this.all<Record<string, unknown>>(
      'SELECT * FROM series_passes ORDER BY priority DESC, title ASC',
    ).map((r) => this.mapSeriesPass(r));
  }

  getSeriesPass(id: string): SeriesPass | null {
    const row = this.get<Record<string, unknown>>('SELECT * FROM series_passes WHERE id = ?', [id]);
    return row ? this.mapSeriesPass(row) : null;
  }

  deleteSeriesPass(id: string): void {
    this.run('DELETE FROM series_passes WHERE id = ?', [id]);
  }

  // ==================== RECORDINGS ====================

  private mapRecording(r: Record<string, unknown>): Recording {
    return {
      id: String(r.id),
      programId: r.program_id ? String(r.program_id) : null,
      seriesPassId: r.series_pass_id ? String(r.series_pass_id) : null,
      channelId: String(r.channel_id),
      channelNumber: String(r.channel_number),
      channelName: String(r.channel_name),
      title: String(r.title),
      subtitle: r.subtitle ? String(r.subtitle) : null,
      description: r.description ? String(r.description) : null,
      episodeNum: r.episode_num ? String(r.episode_num) : null,
      category: String(r.category ?? 'General'),
      scheduledStart: String(r.scheduled_start),
      scheduledEnd: String(r.scheduled_end),
      actualStart: r.actual_start ? String(r.actual_start) : null,
      actualEnd: r.actual_end ? String(r.actual_end) : null,
      paddingStartMin: Number(r.padding_start_min),
      paddingEndMin: Number(r.padding_end_min),
      status: String(r.status) as Recording['status'],
      errorMessage: r.error_message ? String(r.error_message) : null,
      filePath: r.file_path ? String(r.file_path) : null,
      fileSizeBytes: Number(r.file_size_bytes ?? 0),
      durationSec: Number(r.duration_sec ?? 0),
      thumbnailPath: r.thumbnail_path ? String(r.thumbnail_path) : null,
      commercialScanStatus: String(r.commercial_scan_status ?? 'pending') as Recording['commercialScanStatus'],
      commercialCount: Number(r.commercial_count ?? 0),
      watchedPositionSec: Number(r.watched_position_sec ?? 0),
      watched: Number(r.watched) === 1,
      createdAt: String(r.created_at),
    };
  }

  insertRecording(rec: Recording): void {
    this.run(
      `INSERT INTO recordings (
        id, program_id, series_pass_id, channel_id, channel_number, channel_name,
        title, subtitle, description, episode_num, category,
        scheduled_start, scheduled_end, actual_start, actual_end,
        padding_start_min, padding_end_min, status, error_message,
        file_path, file_size_bytes, duration_sec, thumbnail_path,
        commercial_scan_status, commercial_count, watched_position_sec, watched, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rec.id,
        rec.programId,
        rec.seriesPassId,
        rec.channelId,
        rec.channelNumber,
        rec.channelName,
        rec.title,
        rec.subtitle,
        rec.description,
        rec.episodeNum,
        rec.category,
        rec.scheduledStart,
        rec.scheduledEnd,
        rec.actualStart,
        rec.actualEnd,
        rec.paddingStartMin,
        rec.paddingEndMin,
        rec.status,
        rec.errorMessage,
        rec.filePath,
        rec.fileSizeBytes,
        rec.durationSec,
        rec.thumbnailPath,
        rec.commercialScanStatus,
        rec.commercialCount,
        rec.watchedPositionSec,
        rec.watched ? 1 : 0,
        rec.createdAt,
      ],
    );
  }

  updateRecording(id: string, patch: Partial<Recording>): Recording | null {
    const current = this.getRecording(id);
    if (!current) return null;
    const next: Recording = { ...current, ...patch };
    this.run(
      `UPDATE recordings SET
        scheduled_start = ?, scheduled_end = ?, actual_start = ?, actual_end = ?,
        padding_start_min = ?, padding_end_min = ?, status = ?, error_message = ?,
        file_path = ?, file_size_bytes = ?, duration_sec = ?, thumbnail_path = ?,
        commercial_scan_status = ?, commercial_count = ?, watched_position_sec = ?, watched = ?
       WHERE id = ?`,
      [
        next.scheduledStart,
        next.scheduledEnd,
        next.actualStart,
        next.actualEnd,
        next.paddingStartMin,
        next.paddingEndMin,
        next.status,
        next.errorMessage,
        next.filePath,
        next.fileSizeBytes,
        next.durationSec,
        next.thumbnailPath,
        next.commercialScanStatus,
        next.commercialCount,
        next.watchedPositionSec,
        next.watched ? 1 : 0,
        id,
      ],
    );
    return this.getRecording(id);
  }

  getRecording(id: string): Recording | null {
    const row = this.get<Record<string, unknown>>('SELECT * FROM recordings WHERE id = ?', [id]);
    return row ? this.mapRecording(row) : null;
  }

  listRecordings(statuses?: Recording['status'][]): Recording[] {
    if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(', ');
      return this.all<Record<string, unknown>>(
        `SELECT * FROM recordings WHERE status IN (${placeholders}) ORDER BY scheduled_start DESC`,
        statuses,
      ).map((r) => this.mapRecording(r));
    }
    return this.all<Record<string, unknown>>(
      'SELECT * FROM recordings ORDER BY scheduled_start DESC',
    ).map((r) => this.mapRecording(r));
  }

  findRecordingByProgramId(programId: string): Recording | null {
    const row = this.get<Record<string, unknown>>(
      `SELECT * FROM recordings WHERE program_id = ? AND status != 'cancelled' LIMIT 1`,
      [programId],
    );
    return row ? this.mapRecording(row) : null;
  }

  deleteRecording(id: string): void {
    this.run('DELETE FROM recordings WHERE id = ?', [id]);
  }

  // ==================== COMMERCIAL SEGMENTS ====================

  replaceCommercials(recordingId: string, segments: CommercialSegment[]): void {
    this.db.run('BEGIN TRANSACTION');
    try {
      this.db.run('DELETE FROM commercials WHERE recording_id = ?', [recordingId]);
      const stmt = this.db.prepare(
        `INSERT INTO commercials (id, recording_id, start_sec, end_sec, confidence, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const seg of segments) {
        stmt.run([seg.id, recordingId, seg.startSec, seg.endSec, seg.confidence, seg.source]);
      }
      stmt.free();
      this.db.run(
        'UPDATE recordings SET commercial_count = ?, commercial_scan_status = ? WHERE id = ?',
        [segments.length, 'completed', recordingId],
      );
      this.db.run('COMMIT');
      this.scheduleSave();
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  listCommercials(recordingId: string): CommercialSegment[] {
    return this.all<Record<string, unknown>>(
      'SELECT * FROM commercials WHERE recording_id = ? ORDER BY start_sec ASC',
      [recordingId],
    ).map((r) => ({
      id: String(r.id),
      recordingId: String(r.recording_id),
      startSec: Number(r.start_sec),
      endSec: Number(r.end_sec),
      confidence: Number(r.confidence),
      source: String(r.source) as CommercialSegment['source'],
    }));
  }

  // ==================== STREAMING APPS ====================

  private mapStreamingApp(r: Record<string, unknown>): StreamingApp {
    return {
      id: String(r.id),
      name: String(r.name),
      tagline: String(r.tagline ?? ''),
      category: String(r.category ?? 'Streaming'),
      webUrl: String(r.web_url),
      androidPackage: String(r.android_package ?? ''),
      fallbackAndroidPackage: r.fallback_android_package
        ? String(r.fallback_android_package)
        : null,
      brandColor: String(r.brand_color ?? '#334155'),
      monogram: String(r.monogram ?? 'TV'),
      pinned: Number(r.pinned) === 1,
      enabled: Number(r.enabled) === 1,
      sortOrder: Number(r.sort_order ?? 100),
    };
  }

  listStreamingApps(includeDisabled = false): StreamingApp[] {
    const sql = includeDisabled
      ? 'SELECT * FROM streaming_apps ORDER BY sort_order ASC, name ASC'
      : 'SELECT * FROM streaming_apps WHERE enabled = 1 ORDER BY sort_order ASC, name ASC';
    return this.all<Record<string, unknown>>(sql).map((r) => this.mapStreamingApp(r));
  }

  getStreamingApp(id: string): StreamingApp | null {
    const row = this.get<Record<string, unknown>>('SELECT * FROM streaming_apps WHERE id = ?', [id]);
    return row ? this.mapStreamingApp(row) : null;
  }

  upsertStreamingApp(app: StreamingApp): void {
    this.run(
      `INSERT INTO streaming_apps
       (id, name, tagline, category, web_url, android_package, fallback_android_package, brand_color, monogram, pinned, enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         tagline = excluded.tagline,
         category = excluded.category,
         web_url = excluded.web_url,
         android_package = excluded.android_package,
         fallback_android_package = excluded.fallback_android_package,
         brand_color = excluded.brand_color,
         monogram = excluded.monogram,
         pinned = excluded.pinned,
         enabled = excluded.enabled,
         sort_order = excluded.sort_order`,
      [
        app.id,
        app.name,
        app.tagline,
        app.category,
        app.webUrl,
        app.androidPackage,
        app.fallbackAndroidPackage,
        app.brandColor,
        app.monogram,
        app.pinned ? 1 : 0,
        app.enabled ? 1 : 0,
        app.sortOrder,
      ],
    );
  }

  deleteStreamingApp(id: string): void {
    this.run('DELETE FROM streaming_apps WHERE id = ?', [id]);
  }
}
