import type { DvrDatabase } from '../db/database.js';
import type { Channel, Program } from '../types/index.js';
import { loadXmltvContent, parseXmltv } from './xmltvParser.js';
import { generateSamplePrograms } from './sampleGuide.js';

export interface GuideGridRow {
  channel: Channel;
  programs: Program[];
}

export class EpgService {
  private refreshTimer: NodeJS.Timeout | null = null;
  private lastRefreshAt: string | null = null;
  private lastSource: 'xmltv' | 'sample' | null = null;
  private onUpdated?: () => void;

  constructor(private db: DvrDatabase, onUpdated?: () => void) {
    this.onUpdated = onUpdated;
  }

  getStatus() {
    return {
      lastRefreshAt: this.lastRefreshAt,
      lastSource: this.lastSource,
    };
  }

  startAutoRefresh(): void {
    this.stopAutoRefresh();
    const hours = Math.max(1, this.db.getSettings().xmltvRefreshHours || 6);
    this.refreshTimer = setInterval(() => {
      void this.refreshGuide().catch((err) => {
        console.error('[EPG] Scheduled refresh failed:', err);
      });
    }, hours * 3600 * 1000);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async importXmltv(source: string): Promise<{
    programCount: number;
    matchedChannelCount: number;
    xmlChannelCount: number;
  }> {
    const channels = this.db.listChannels(true);
    const xml = await loadXmltvContent(source);
    const parsed = parseXmltv(xml, channels);

    for (const [channelId, match] of parsed.matchedChannels.entries()) {
      this.db.updateChannel(channelId, {
        xmltvId: match.xmltvId,
        logoUrl: match.logoUrl,
      });
    }

    const updatedChannelIds = Array.from(parsed.matchedChannels.keys());
    if (updatedChannelIds.length > 0 && parsed.programs.length > 0) {
      this.db.replaceProgramsForChannels(updatedChannelIds, parsed.programs);
    }

    this.lastRefreshAt = new Date().toISOString();
    this.lastSource = 'xmltv';
    this.onUpdated?.();

    return {
      programCount: parsed.programs.length,
      matchedChannelCount: updatedChannelIds.length,
      xmlChannelCount: parsed.xmlChannelCount,
    };
  }

  generateSampleGuide(hoursAhead = 48): { programCount: number; channelCount: number } {
    const channels = this.db.listChannels(true);
    if (channels.length === 0) {
      return { programCount: 0, channelCount: 0 };
    }
    const programs = generateSamplePrograms(channels, hoursAhead);
    this.db.replaceProgramsForChannels(
      channels.map((c) => c.id),
      programs,
    );
    this.lastRefreshAt = new Date().toISOString();
    this.lastSource = 'sample';
    this.onUpdated?.();
    return { programCount: programs.length, channelCount: channels.length };
  }

  async refreshGuide(): Promise<{ source: 'xmltv' | 'sample'; programCount: number }> {
    const settings = this.db.getSettings();
    if (settings.xmltvUrl && settings.xmltvUrl.trim().length > 0) {
      const res = await this.importXmltv(settings.xmltvUrl.trim());
      if (res.programCount > 0) {
        return { source: 'xmltv', programCount: res.programCount };
      }
    }
    const sample = this.generateSampleGuide(48);
    return { source: 'sample', programCount: sample.programCount };
  }

  getGuideGrid(startIso: string, endIso: string): {
    start: string;
    end: string;
    rows: GuideGridRow[];
  } {
    const channels = this.db.listChannels(false);
    const programs = this.db.queryProgramsInRange(startIso, endIso);
    const byChannel = new Map<string, Program[]>();

    for (const p of programs) {
      const list = byChannel.get(p.channelId) ?? [];
      list.push(p);
      byChannel.set(p.channelId, list);
    }

    return {
      start: startIso,
      end: endIso,
      rows: channels.map((channel) => ({
        channel,
        programs: byChannel.get(channel.id) ?? [],
      })),
    };
  }

  getNowPlaying(): Array<{ channel: Channel; current: Program | null; next: Program | null }> {
    const now = new Date();
    const soon = new Date(now.getTime() + 4 * 3600 * 1000);
    const grid = this.getGuideGrid(now.toISOString(), soon.toISOString());
    const nowMs = now.getTime();

    return grid.rows.map(({ channel, programs }) => {
      const current =
        programs.find(
          (p) => Date.parse(p.startTime) <= nowMs && Date.parse(p.endTime) > nowMs,
        ) ?? null;
      const next =
        programs.find((p) => Date.parse(p.startTime) > nowMs && p.id !== current?.id) ?? null;
      return { channel, current, next };
    });
  }
}
