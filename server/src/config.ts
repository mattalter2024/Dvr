import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { DvrSettings, SystemCapabilities } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const SERVER_ROOT = path.resolve(__dirname, '..');
export const WORKSPACE_ROOT = path.resolve(SERVER_ROOT, '..');

export const envConfig = {
  port: Number(process.env.PORT ?? 8096),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(WORKSPACE_ROOT, process.env.DATA_DIR ?? './data'),
  recordingsDir: path.resolve(WORKSPACE_ROOT, process.env.RECORDINGS_DIR ?? './recordings'),
  hlsDir: path.resolve(WORKSPACE_ROOT, process.env.DATA_DIR ?? './data', 'hls'),
  thumbnailsDir: path.resolve(WORKSPACE_ROOT, process.env.DATA_DIR ?? './data', 'thumbnails'),
  webDistDir: path.resolve(WORKSPACE_ROOT, 'web', 'dist'),
  discoveryUdpPort: Number(process.env.DISCOVERY_UDP_PORT ?? 41234),
  serverName: process.env.SERVER_NAME ?? 'AirVault Home DVR',
  defaultFfmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  defaultFfprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
  defaultComskipPath: process.env.COMSKIP_PATH ?? 'comskip',
  defaultComskipIniPath: path.resolve(
    WORKSPACE_ROOT,
    process.env.COMSKIP_INI_PATH ?? './server/comskip.ini',
  ),
  initialXmltvUrl: process.env.XMLTV_URL ?? '',
  enableVirtualTuner: (process.env.ENABLE_VIRTUAL_TUNER ?? 'true').toLowerCase() !== 'false',
  virtualTunerCount: Number(process.env.VIRTUAL_TUNER_COUNT ?? 2),
  autoCommercialScan: (process.env.AUTO_COMMERCIAL_SCAN ?? 'true').toLowerCase() !== 'false',
};

export function ensureDirectories(): void {
  for (const dir of [
    envConfig.dataDir,
    envConfig.recordingsDir,
    envConfig.hlsDir,
    envConfig.thumbnailsDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const DEFAULT_SETTINGS: DvrSettings = {
  serverName: envConfig.serverName,
  xmltvUrl: envConfig.initialXmltvUrl,
  xmltvRefreshHours: 6,
  defaultPaddingStartMin: 1,
  defaultPaddingEndMin: 2,
  defaultRetentionDays: 30,
  deleteWatchedAfterDays: 7,
  maxStorageGb: 0,
  cleanupIntervalHours: 6,
  autoCommercialScan: envConfig.autoCommercialScan,
  autoSkipCommercialsDefault: true,
  comskipPath: envConfig.defaultComskipPath,
  comskipIniPath: envConfig.defaultComskipIniPath,
  ffmpegPath: envConfig.defaultFfmpegPath,
  ffprobePath: envConfig.defaultFfprobePath,
  transcodeLiveTv: true,
  enableVirtualTuner: envConfig.enableVirtualTuner,
  virtualTunerCount: envConfig.virtualTunerCount,
};

function probeBinary(bin: string, args: string[]): { available: boolean; firstLine: string | null } {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    });
    const line = out.split(/\r?\n/).find((l) => l.trim().length > 0) ?? null;
    return { available: true, firstLine: line };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && (err as { code?: string }).code !== 'ENOENT') {
      const stdout = String((err as { stdout?: Buffer | string }).stdout ?? '');
      const stderr = String((err as { stderr?: Buffer | string }).stderr ?? '');
      const combined = `${stdout}\n${stderr}`;
      if (combined.toLowerCase().includes('comskip') || combined.toLowerCase().includes('ffmpeg')) {
        return {
          available: true,
          firstLine: combined.split(/\r?\n/).find((l) => l.trim().length > 0) ?? null,
        };
      }
    }
    return { available: false, firstLine: null };
  }
}

/**
 * Detects available hardware-accelerated H.264 encoders in FFmpeg (NVENC, Intel QSV, AMD AMF,
 * macOS VideoToolbox, Linux VAAPI) so multi-room live transcoding offloads CPU work to GPU.
 */
function detectHardwareEncoder(ffmpegPath: string): string | null {
  try {
    const out = execFileSync(ffmpegPath, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    const preferred = [
      'h264_nvenc',
      'h264_qsv',
      'h264_amf',
      'h264_videotoolbox',
      'h264_vaapi',
    ];
    for (const enc of preferred) {
      if (out.includes(enc)) return enc;
    }
  } catch {
    // ignore probe failures
  }
  return null;
}

export function getLanAddresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

// In-memory TTL cache so repeated /api/health & live tune calls NEVER block the event loop
// with synchronous execFileSync subprocess spawns!
let cachedCaps: { key: string; expiresAt: number; value: SystemCapabilities } | null = null;
const CAPS_TTL_MS = 60_000;

export function invalidateCapabilitiesCache(): void {
  cachedCaps = null;
}

export function detectCapabilities(settings: DvrSettings): SystemCapabilities {
  const cacheKey = `${settings.ffmpegPath}|${settings.ffprobePath}|${settings.comskipPath}`;
  const now = Date.now();
  if (cachedCaps && cachedCaps.key === cacheKey && cachedCaps.expiresAt > now) {
    return cachedCaps.value;
  }

  const ffmpeg = probeBinary(settings.ffmpegPath, ['-version']);
  const ffprobe = probeBinary(settings.ffprobePath, ['-version']);
  const comskip = probeBinary(settings.comskipPath, ['-h']);
  const hwEncoder = ffmpeg.available ? detectHardwareEncoder(settings.ffmpegPath) : null;

  const value: SystemCapabilities = {
    ffmpegAvailable: ffmpeg.available,
    ffmpegVersion: ffmpeg.firstLine,
    ffprobeAvailable: ffprobe.available,
    comskipAvailable: comskip.available,
    comskipPath: settings.comskipPath,
    hwEncoder,
    lanAddresses: getLanAddresses(),
    port: envConfig.port,
    discoveryUdpPort: envConfig.discoveryUdpPort,
  };

  cachedCaps = { key: cacheKey, expiresAt: now + CAPS_TTL_MS, value };
  return value;
}
