import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { Channel, Program } from '../types/index.js';

interface XmltvChannelNode {
  '@_id'?: string;
  'display-name'?: unknown;
  icon?: { '@_src'?: string } | Array<{ '@_src'?: string }>;
}

interface XmltvProgrammeNode {
  '@_start'?: string;
  '@_stop'?: string;
  '@_channel'?: string;
  title?: unknown;
  'sub-title'?: unknown;
  desc?: unknown;
  category?: unknown;
  'episode-num'?: unknown;
  icon?: { '@_src'?: string } | Array<{ '@_src'?: string }>;
  new?: unknown;
  live?: unknown;
  rating?: { value?: unknown } | Array<{ value?: unknown }>;
}

/**
 * Parses XMLTV timestamps like "20261124200000 -0600" or "20261124200000 +0000" into ISO-8601 UTC.
 */
export function parseXmltvTimestamp(raw: string): string | null {
  const match = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-]\d{4}|Z))?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '00', tz = '+0000'] = match;
  const tzIso = tz === 'Z' ? 'Z' : `${tz.slice(0, 3)}:${tz.slice(3, 5)}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${tzIso}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractText(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (Array.isArray(node)) {
    for (const item of node) {
      const t = extractText(item);
      if (t) return t;
    }
    return null;
  }
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text']).trim();
  }
  return null;
}

function extractAllTexts(node: unknown): string[] {
  if (node == null) return [];
  if (Array.isArray(node)) {
    return node.map(extractText).filter((v): v is string => Boolean(v));
  }
  const single = extractText(node);
  return single ? [single] : [];
}

function extractIcon(iconNode: XmltvChannelNode['icon']): string | null {
  if (!iconNode) return null;
  if (Array.isArray(iconNode)) return iconNode[0]?.['@_src'] ?? null;
  return iconNode['@_src'] ?? null;
}

/**
 * Parses XMLTV `episode-num` nodes (`xmltv_ns` like "3.11.0/1" -> "S04E12" or `onscreen` like "S04E12").
 */
function extractEpisodeNum(node: unknown): string | null {
  if (!node) return null;
  const list = Array.isArray(node) ? node : [node];
  for (const entry of list) {
    if (typeof entry === 'object' && entry !== null) {
      const obj = entry as Record<string, unknown>;
      const system = String(obj['@_system'] ?? '');
      const text = extractText(obj);
      if (!text) continue;
      if (system === 'xmltv_ns') {
        const parts = text.split('.');
        const season = Number.parseInt(parts[0]?.split('/')[0] ?? '', 10);
        const ep = Number.parseInt(parts[1]?.split('/')[0] ?? '', 10);
        if (!Number.isNaN(season) && !Number.isNaN(ep)) {
          return `S${String(season + 1).padStart(2, '0')}E${String(ep + 1).padStart(2, '0')}`;
        }
        if (!Number.isNaN(ep)) {
          return `E${String(ep + 1).padStart(2, '0')}`;
        }
      } else if (system === 'onscreen' || system === 'SxxExx') {
        return text;
      }
    } else {
      const text = extractText(entry);
      if (text) return text;
    }
  }
  return null;
}

export async function loadXmltvContent(source: string): Promise<string> {
  const trimmed = source.trim();
  let rawBuffer: Buffer;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const res = await fetch(trimmed);
    if (!res.ok) {
      throw new Error(`Failed to download XMLTV from ${trimmed}: HTTP ${res.status}`);
    }
    rawBuffer = Buffer.from(await res.arrayBuffer());
  } else {
    rawBuffer = fs.readFileSync(trimmed);
  }

  // Auto-decompress gzipped XMLTV (.xml.gz) by checking gzip magic bytes 0x1f 0x8b
  if (rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
    return zlib.gunzipSync(rawBuffer).toString('utf8');
  }
  return rawBuffer.toString('utf8');
}

export function parseXmltv(
  xmlString: string,
  channels: Channel[],
): {
  matchedChannels: Map<string, { xmltvId: string; logoUrl: string | null }>;
  programs: Program[];
  xmlChannelCount: number;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'channel' || name === 'programme' || name === 'display-name',
  });
  const doc = parser.parse(xmlString) as {
    tv?: { channel?: XmltvChannelNode[]; programme?: XmltvProgrammeNode[] };
  };

  const xmlChannels = doc.tv?.channel ?? [];
  const xmlProgrammes = doc.tv?.programme ?? [];

  // Build mapping from XMLTV channel id -> AirVault channel id
  const xmlIdToChannel = new Map<string, Channel>();
  const matchedChannels = new Map<string, { xmltvId: string; logoUrl: string | null }>();

  for (const xmlCh of xmlChannels) {
    const xmlId = xmlCh['@_id'];
    if (!xmlId) continue;
    const displayNames = extractAllTexts(xmlCh['display-name']).map((d) => d.toLowerCase());
    const logoUrl = extractIcon(xmlCh.icon);

    const matched = channels.find((ch) => {
      if (ch.xmltvId && ch.xmltvId.toLowerCase() === xmlId.toLowerCase()) return true;
      const num = ch.guideNumber.toLowerCase();
      const name = ch.guideName.toLowerCase();
      const net = ch.network.toLowerCase();
      return (
        xmlId.toLowerCase() === num ||
        xmlId.toLowerCase().includes(name) ||
        displayNames.some(
          (d) => d === num || d === name || d.startsWith(`${num} `) || (net && d === net),
        )
      );
    });

    if (matched) {
      xmlIdToChannel.set(xmlId, matched);
      matchedChannels.set(matched.id, { xmltvId: xmlId, logoUrl });
    }
  }

  const programs: Program[] = [];
  for (const node of xmlProgrammes) {
    const xmlChId = node['@_channel'];
    if (!xmlChId) continue;
    const ch = xmlIdToChannel.get(xmlChId);
    if (!ch) continue;

    const startTime = node['@_start'] ? parseXmltvTimestamp(node['@_start']) : null;
    const endTime = node['@_stop'] ? parseXmltvTimestamp(node['@_stop']) : null;
    const title = extractText(node.title);
    if (!startTime || !endTime || !title) continue;

    const subtitle = extractText(node['sub-title']);
    const description = extractText(node.desc);
    const categories = extractAllTexts(node.category);
    const category = categories[0] ?? 'General';
    const episodeNum = extractEpisodeNum(node['episode-num']);
    const posterUrl = extractIcon(node.icon);
    const isNew = node.new !== undefined;
    const isLive = node.live !== undefined;
    const ratingNode = Array.isArray(node.rating) ? node.rating[0] : node.rating;
    const rating = extractText(ratingNode?.value);

    const hash = crypto
      .createHash('sha1')
      .update(`${ch.id}|${startTime}|${title}`)
      .digest('hex')
      .slice(0, 16);

    programs.push({
      id: `prog-${hash}`,
      channelId: ch.id,
      title,
      subtitle,
      description,
      startTime,
      endTime,
      category,
      episodeNum,
      seriesId: `series-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      posterUrl,
      isNew,
      isLive,
      rating,
    });
  }

  return { matchedChannels, programs, xmlChannelCount: xmlChannels.length };
}
