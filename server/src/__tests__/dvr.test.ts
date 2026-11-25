import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DvrDatabase } from '../db/database.js';
import { parseXmltv, parseXmltvTimestamp } from '../epg/xmltvParser.js';
import {
  inferCommercialsFromTransitions,
  parseEdlContent,
  serializeEdl,
} from '../dvr/commercialSkip.js';
import { createVirtualChannels, createVirtualTunerDevice } from '../tuners/virtualTuner.js';
import { TunerPool } from '../tuners/tunerPool.js';
import { generateSamplePrograms } from '../epg/sampleGuide.js';
import { DvrScheduler } from '../dvr/scheduler.js';
import { DvrRecorder } from '../dvr/recorder.js';
import { CommercialSkipService } from '../dvr/commercialSkip.js';
import { DvrCleanupService } from '../dvr/cleanupService.js';

describe('XMLTV EPG Parser', () => {
  it('parses XMLTV timestamps with timezone offsets into ISO UTC', () => {
    const iso = parseXmltvTimestamp('20261124200000 -0600');
    assert.equal(iso, '2026-11-25T02:00:00.000Z');
  });

  it('matches channels and extracts programs with xmltv_ns episode numbers', () => {
    const channels = createVirtualChannels();
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
    <tv>
      <channel id="cbs.ota.local">
        <display-name>2.1 WCBS-HD</display-name>
        <icon src="https://example.com/cbs.png" />
      </channel>
      <programme start="20261124200000 -0600" stop="20261124210000 -0600" channel="cbs.ota.local">
        <title>Harbor Watch</title>
        <sub-title>Tide of Evidence</sub-title>
        <desc>Investigators track a signal across the bay.</desc>
        <category>Drama</category>
        <episode-num system="xmltv_ns">5.11.0/1</episode-num>
        <new />
      </programme>
    </tv>`;

    const result = parseXmltv(sampleXml, channels);
    assert.equal(result.matchedChannels.size, 1);
    assert.equal(result.programs.length, 1);
    assert.equal(result.programs[0].title, 'Harbor Watch');
    assert.equal(result.programs[0].episodeNum, 'S06E12');
    assert.equal(result.programs[0].isNew, true);
  });
});

describe('Commercial Detection & EDL Serialization', () => {
  it('parses and round-trips standard Comskip EDL files', () => {
    const edl = `# Comskip output\n482.50\t615.20\t3\n1210.00\t1345.00\t0\n1500.00\t1510.00\t1\n`;
    const segs = parseEdlContent(edl, 'rec-1', 'comskip');
    assert.equal(segs.length, 2); // action 1 (mute) is ignored, 0 and 3 are commercial skips
    assert.equal(segs[0].startSec, 482.5);
    assert.equal(segs[0].endSec, 615.2);

    const exported = serializeEdl(segs);
    assert.ok(exported.includes('482.50\t615.20\t3'));
    assert.ok(exported.includes('1210.00\t1345.00\t3'));
  });

  it('infers commercial breaks from FFmpeg black-frame + silence transitions', () => {
    const blacks = [
      { start: 28.0, end: 29.4 },
      { start: 43.0, end: 44.4 },
      { start: 73.0, end: 74.4 },
      { start: 88.0, end: 89.4 },
    ];
    const silences = [
      { start: 28.1, end: 29.3 },
      { start: 43.1, end: 44.3 },
      { start: 73.1, end: 74.3 },
      { start: 88.1, end: 89.3 },
    ];
    const segs = inferCommercialsFromTransitions(blacks, silences, 120, 'rec-test');
    assert.equal(segs.length, 2);
    assert.ok(segs[0].startSec >= 28 && segs[0].endSec <= 44.5);
    assert.ok(segs[1].startSec >= 73 && segs[1].endSec <= 89.5);
  });
});

describe('Whole-House Tuner Pool & DVR Scheduler', () => {
  it('shares a tuner slot for multiple live viewers on the same channel and enforces tuner limits', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airvault-test-'));
    const db = new DvrDatabase(path.join(tmpDir, 'test.sqlite'));
    await db.init();

    const tuner = createVirtualTunerDevice(2);
    db.upsertTuner(tuner);
    const channels = createVirtualChannels();
    for (const ch of channels) db.upsertChannel(ch);

    const pool = new TunerPool(db);
    const l1 = pool.acquire(channels[0], 'live', 'tv-living-room');
    const l2 = pool.acquire(channels[0], 'live', 'tv-bedroom');
    assert.equal(l1.id, l2.id); // Same channel shares one tuner slot
    assert.equal(l2.clientCount, 2);

    const l3 = pool.acquire(channels[1], 'live', 'tv-kitchen');
    assert.notEqual(l3.tunerSlot, l1.tunerSlot);

    // 3rd distinct channel should fail on a 2-tuner device
    assert.throws(() => pool.acquire(channels[2], 'live', 'tv-patio'));

    pool.release(l1.id);
    pool.release(l2.id);
    pool.release(l3.id);
    assert.equal(pool.getActiveLeases().length, 0);

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates Series Passes and flags tuner conflicts when overlapping schedules exceed tuner count', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airvault-sched-'));
    const db = new DvrDatabase(path.join(tmpDir, 'test.sqlite'));
    await db.init();

    db.upsertTuner(createVirtualTunerDevice(1)); // 1-tuner device to trigger conflict
    const channels = createVirtualChannels().slice(0, 2);
    for (const ch of channels) db.upsertChannel(ch);

    const programs = generateSamplePrograms(channels, 12);
    db.replaceProgramsForChannels(
      channels.map((c) => c.id),
      programs,
    );

    const pool = new TunerPool(db);
    const comskip = new CommercialSkipService(db);
    const recorder = new DvrRecorder(db, pool, comskip);
    const scheduler = new DvrScheduler(db, pool, recorder);

    // Pick two future overlapping programs on different channels
    const futureMs = Date.now() + 2 * 3600 * 1000;
    const progA = programs.find(
      (p) => p.channelId === channels[0].id && Date.parse(p.startTime) > futureMs,
    )!;
    const progB = programs.find(
      (p) =>
        p.channelId === channels[1].id &&
        Date.parse(p.startTime) < Date.parse(progA.endTime) &&
        Date.parse(p.endTime) > Date.parse(progA.startTime),
    )!;

    scheduler.scheduleProgram(progA.id);
    scheduler.scheduleProgram(progB.id);

    const allRecs = db.listRecordings();
    assert.equal(allRecs.length, 2);
    assert.ok(allRecs.some((r) => r.status === 'conflict'));

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cleans up expired and watched recordings while protecting locked and Keep Forever items', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airvault-cleanup-'));
    const db = new DvrDatabase(path.join(tmpDir, 'test.sqlite'));
    await db.init();
    db.updateSettings({ defaultRetentionDays: 30, deleteWatchedAfterDays: 7, maxStorageGb: 0 });

    const nowMs = Date.now();
    const daysAgo = (d: number) => new Date(nowMs - d * 24 * 3600 * 1000).toISOString();

    const makeRec = (
      id: string,
      opts: { ageDays: number; keepDays: number; keepProtected?: boolean; watched?: boolean },
    ) => ({
      id,
      programId: null,
      seriesPassId: null,
      channelId: 'ch-1',
      channelNumber: '2.1',
      channelName: 'WCBS-HD',
      title: `Show ${id}`,
      subtitle: null,
      description: null,
      episodeNum: null,
      category: 'Drama',
      scheduledStart: daysAgo(opts.ageDays),
      scheduledEnd: daysAgo(opts.ageDays),
      actualStart: daysAgo(opts.ageDays),
      actualEnd: daysAgo(opts.ageDays),
      paddingStartMin: 0,
      paddingEndMin: 0,
      status: 'completed' as const,
      errorMessage: null,
      filePath: null,
      fileSizeBytes: 500_000_000,
      durationSec: 1800,
      thumbnailPath: null,
      commercialScanStatus: 'completed' as const,
      commercialCount: 2,
      watchedPositionSec: opts.watched ? 1800 : 0,
      watched: Boolean(opts.watched),
      keepDays: opts.keepDays,
      keepProtected: Boolean(opts.keepProtected),
      createdAt: daysAgo(opts.ageDays),
    });

    // 1. Expired (40 days old, keep 30d) -> MUST delete
    db.insertRecording(makeRec('expired', { ageDays: 40, keepDays: 30 }));
    // 2. Watched 10 days ago (deleteWatchedAfterDays = 7) -> MUST delete
    db.insertRecording(makeRec('watched-old', { ageDays: 10, keepDays: 30, watched: true }));
    // 3. Locked / Protected (45 days old, keep 14d, keepProtected = true) -> MUST KEEP
    db.insertRecording(makeRec('locked', { ageDays: 45, keepDays: 14, keepProtected: true }));
    // 4. Keep Forever (90 days old, keepDays = 0, unwatched) -> MUST KEEP
    db.insertRecording(makeRec('forever', { ageDays: 90, keepDays: 0 }));

    const cleanup = new DvrCleanupService(db);
    const preview = cleanup.runCleanup(true, nowMs);
    assert.equal(preview.expiredDeleted, 1);
    assert.equal(preview.watchedDeleted, 1);
    assert.equal(db.listRecordings().length, 4); // dryRun does not delete

    const report = cleanup.runCleanup(false, nowMs);
    assert.equal(report.expiredDeleted, 1);
    assert.equal(report.watchedDeleted, 1);

    const remainingIds = db.listRecordings().map((r) => r.id).sort();
    assert.deepEqual(remainingIds, ['forever', 'locked']);

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
