import dgram from 'node:dgram';
import type { Channel, TunerDevice } from '../types/index.js';

interface HdhrDiscoverJson {
  FriendlyName?: string;
  ModelNumber?: string;
  FirmwareName?: string;
  FirmwareVersion?: string;
  DeviceID?: string;
  DeviceAuth?: string;
  BaseURL?: string;
  LineupURL?: string;
  TunerCount?: number;
}

interface HdhrLineupEntry {
  GuideNumber: string;
  GuideName: string;
  URL: string;
  HD?: number;
  Favorite?: number;
  DRM?: number;
}

/**
 * Computes standard IEEE 802.3 CRC-32 used by SiliconDust HDHomeRun UDP discovery packets.
 */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds an HDHomeRun UDP discovery request packet (port 65001).
 * Type: 0x0002 (DISCOVER_REQ), Payload: DeviceType = TUNER (0x00000001), DeviceID = WILDCARD (0xFFFFFFFF)
 */
function buildDiscoverPacket(): Buffer {
  const payload = Buffer.from([
    0x01, 0x04, 0x00, 0x00, 0x00, 0x01, // Tag 0x01 (Device Type), len 4, value 1 (Tuner)
    0x02, 0x04, 0xff, 0xff, 0xff, 0xff, // Tag 0x02 (Device ID), len 4, wildcard
  ]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0x0002, 0); // HDHOMERUN_TYPE_DISCOVER_REQ
  header.writeUInt16BE(payload.length, 2);
  const body = Buffer.concat([header, payload]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32LE(crc32(body), 0);
  return Buffer.concat([body, checksum]);
}

/**
 * Broadcasts an HDHomeRun UDP discovery packet on the local subnet and collects responding IP addresses.
 */
export async function discoverHdHomeRunIps(timeoutMs = 2000): Promise<string[]> {
  return new Promise((resolve) => {
    const foundIps = new Set<string>();
    const socket = dgram.createSocket('udp4');

    const finish = () => {
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
      resolve(Array.from(foundIps));
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.on('error', () => {
      clearTimeout(timer);
      finish();
    });

    socket.on('message', (msg, rinfo) => {
      // HDHOMERUN_TYPE_DISCOVER_RPY == 0x0003
      if (msg.length >= 8 && msg.readUInt16BE(0) === 0x0003) {
        foundIps.add(rinfo.address);
      }
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        const packet = buildDiscoverPacket();
        socket.send(packet, 0, packet.length, 65001, '255.255.255.255');
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  });
}

function normalizeBaseUrl(hostOrUrl: string): { host: string; baseUrl: string } {
  const trimmed = hostOrUrl.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const u = new URL(trimmed);
    return { host: u.hostname, baseUrl: `${u.protocol}//${u.host}` };
  }
  return { host: trimmed, baseUrl: `http://${trimmed}` };
}

/**
 * Probes an HDHomeRun tuner via HTTP /discover.json and /lineup.json.
 */
export async function probeHdHomeRun(hostOrUrl: string): Promise<{
  tuner: TunerDevice;
  channels: Channel[];
}> {
  const { host, baseUrl } = normalizeBaseUrl(hostOrUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const discoverRes = await fetch(`${baseUrl}/discover.json`, { signal: controller.signal });
    if (!discoverRes.ok) {
      throw new Error(`HDHomeRun discover.json returned HTTP ${discoverRes.status}`);
    }
    const info = (await discoverRes.json()) as HdhrDiscoverJson;
    const deviceId = info.DeviceID ?? host.replace(/\./g, '');
    const tunerId = `hdhr-${deviceId.toLowerCase()}`;
    const resolvedBaseUrl = (info.BaseURL ?? baseUrl).replace(/\/+$/, '');

    const tuner: TunerDevice = {
      id: tunerId,
      name: info.FriendlyName ?? `HDHomeRun (${host})`,
      type: 'hdhomerun',
      host,
      deviceId,
      modelNumber: info.ModelNumber ?? 'HDHomeRun',
      tunerCount: Math.max(1, Number(info.TunerCount ?? 2)),
      baseUrl: resolvedBaseUrl,
      enabled: true,
      lastSeenAt: new Date().toISOString(),
    };

    const lineupUrl = info.LineupURL ?? `${resolvedBaseUrl}/lineup.json`;
    const lineupRes = await fetch(lineupUrl, { signal: controller.signal });
    const channels: Channel[] = [];

    if (lineupRes.ok) {
      const lineup = (await lineupRes.json()) as HdhrLineupEntry[];
      for (const item of lineup) {
        if (item.DRM === 1) continue; // Skip DRM-encrypted channels that cannot be unencrypted over HTTP
        const streamUrl =
          item.URL || `${resolvedBaseUrl}:5004/auto/v${encodeURIComponent(item.GuideNumber)}`;
        channels.push({
          id: `${tunerId}-ch-${item.GuideNumber}`,
          tunerId,
          guideNumber: item.GuideNumber,
          guideName: item.GuideName,
          network: inferNetworkFromCallsign(item.GuideName),
          streamUrl,
          logoUrl: null,
          xmltvId: null,
          hd: item.HD === 1 || item.GuideName.toUpperCase().includes('HD'),
          favorite: item.Favorite === 1,
          enabled: true,
        });
      }
    }

    return { tuner, channels };
  } finally {
    clearTimeout(timeout);
  }
}

function inferNetworkFromCallsign(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes('CBS') || upper.includes('WCBS') || upper.includes('KCBS')) return 'CBS';
  if (upper.includes('NBC') || upper.includes('WNBC') || upper.includes('KNBC')) return 'NBC';
  if (upper.includes('ABC') || upper.includes('WABC') || upper.includes('KABC')) return 'ABC';
  if (upper.includes('FOX') || upper.includes('WNYW') || upper.includes('KTTV')) return 'FOX';
  if (upper.includes('PBS') || upper.includes('WNET') || upper.includes('KQED')) return 'PBS';
  if (upper.includes('CW') || upper.includes('WPIX')) return 'The CW';
  if (upper.includes('METV')) return 'MeTV';
  if (upper.includes('ION')) return 'ION';
  return 'OTA';
}
