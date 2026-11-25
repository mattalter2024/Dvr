export interface TunerDevice {
  id: string;
  name: string;
  type: 'hdhomerun' | 'virtual';
  host: string;
  deviceId: string;
  modelNumber: string;
  tunerCount: number;
  baseUrl: string;
  enabled: boolean;
  lastSeenAt: string;
}

export interface TunerLease {
  id: string;
  tunerId: string;
  tunerSlot: number;
  channelNumber: string;
  channelId: string;
  purpose: 'live' | 'recording';
  ownerId: string;
  clientCount: number;
  startedAt: string;
}

export interface TunerUtilization {
  tuner: TunerDevice;
  activeLeases: TunerLease[];
  freeSlots: number;
}

export interface Channel {
  id: string;
  tunerId: string;
  guideNumber: string;
  guideName: string;
  network: string;
  streamUrl: string;
  logoUrl: string | null;
  xmltvId: string | null;
  hd: boolean;
  favorite: boolean;
  enabled: boolean;
  watchCount?: number;
  lastWatchedAt?: string | null;
}

export interface Program {
  id: string;
  channelId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  startTime: string;
  endTime: string;
  category: string;
  episodeNum: string | null;
  seriesId: string | null;
  posterUrl: string | null;
  isNew: boolean;
  isLive: boolean;
  rating: string | null;
}

export interface CommercialSegment {
  id: string;
  recordingId: string;
  startSec: number;
  endSec: number;
  confidence: number;
  source: 'comskip' | 'ffmpeg' | 'synthetic' | 'manual';
}

export interface Recording {
  id: string;
  programId: string | null;
  seriesPassId: string | null;
  channelId: string;
  channelNumber: string;
  channelName: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  episodeNum: string | null;
  category: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  paddingStartMin: number;
  paddingEndMin: number;
  status: 'scheduled' | 'recording' | 'completed' | 'failed' | 'cancelled' | 'conflict';
  errorMessage: string | null;
  filePath: string | null;
  fileSizeBytes: number;
  durationSec: number;
  thumbnailPath: string | null;
  commercialScanStatus: 'pending' | 'scanning' | 'completed' | 'failed' | 'skipped';
  commercialCount: number;
  watchedPositionSec: number;
  watched: boolean;
  keepDays: number;
  keepProtected: boolean;
  createdAt: string;
}

export interface SeriesPass {
  id: string;
  title: string;
  channelId: string | null;
  newOnly: boolean;
  paddingStartMin: number;
  paddingEndMin: number;
  keepLimit: number;
  keepDays: number;
  priority: number;
  enabled: boolean;
  createdAt: string;
}

export interface StreamingApp {
  id: string;
  name: string;
  tagline: string;
  category: string;
  webUrl: string;
  androidPackage: string;
  fallbackAndroidPackage: string | null;
  brandColor: string;
  monogram: string;
  pinned: boolean;
  enabled: boolean;
  sortOrder: number;
}

export interface LiveSession {
  id: string;
  channelId: string;
  channelNumber: string;
  channelName: string;
  tunerId: string;
  playlistUrl: string;
  directStreamUrl: string | null;
  mode: 'hls-ffmpeg' | 'direct-proxy' | 'simulated';
  startedAt: string;
  lastHeartbeatAt: string;
  viewerCount: number;
}

export interface DvrSettings {
  serverName: string;
  xmltvUrl: string;
  xmltvRefreshHours: number;
  defaultPaddingStartMin: number;
  defaultPaddingEndMin: number;
  defaultRetentionDays: number;
  deleteWatchedAfterDays: number;
  maxStorageGb: number;
  cleanupIntervalHours: number;
  autoCommercialScan: boolean;
  autoSkipCommercialsDefault: boolean;
  comskipPath: string;
  comskipIniPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  transcodeLiveTv: boolean;
  enableVirtualTuner: boolean;
  virtualTunerCount: number;
}

export interface CleanupReport {
  ranAt: string;
  dryRun: boolean;
  expiredDeleted: number;
  watchedDeleted: number;
  quotaDeleted: number;
  orphansRemoved: number;
  bytesFreed: number;
  totalRecordingsBytes: number;
  totalRecordingsCount: number;
  protectedCount: number;
}

export interface CleanupStatus {
  totalRecordingsBytes: number;
  totalRecordingsCount: number;
  protectedCount: number;
  maxStorageGb: number;
  cleanupIntervalHours: number;
  lastReport: CleanupReport | null;
  preview: CleanupReport;
}

export interface SystemCapabilities {
  ffmpegAvailable: boolean;
  ffmpegVersion: string | null;
  ffprobeAvailable: boolean;
  comskipAvailable: boolean;
  comskipPath: string;
  lanAddresses: string[];
  port: number;
  discoveryUdpPort: number;
}

export interface HealthResponse {
  status: string;
  serverName: string;
  capabilities: SystemCapabilities;
  epg: { lastRefreshAt: string | null; lastSource: string | null };
  stats: {
    tuners: number;
    channels: number;
    activeRecordings: number;
    activeLiveSessions: number;
    completedRecordings: number;
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => req<HealthResponse>('/api/health'),
  getTuners: () => req<{ tuners: TunerUtilization[]; activeLeases: TunerLease[] }>('/api/tuners'),
  discoverHdhr: () =>
    req<{ discoveredIps: string[]; discovered: Array<{ tuner: TunerDevice; channelCount: number }> }>(
      '/api/tuners/discover',
      { method: 'POST' },
    ),
  addHdhr: (host: string) =>
    req<{ tuner: TunerDevice; channelCount: number }>('/api/tuners/hdhomerun', {
      method: 'POST',
      body: JSON.stringify({ host }),
    }),
  enableVirtualTuner: (tunerCount = 2) =>
    req<{ tuner: TunerDevice; channelCount: number }>('/api/tuners/virtual', {
      method: 'POST',
      body: JSON.stringify({ tunerCount }),
    }),
  deleteTuner: (id: string) => req<void>(`/api/tuners/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getChannels: () => req<{ channels: Channel[] }>('/api/channels'),
  updateChannel: (id: string, patch: Partial<Channel>) =>
    req<{ channel: Channel }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getGuide: (start?: string, hours = 6) => {
    const qs = new URLSearchParams({ hours: String(hours) });
    if (start) qs.set('start', start);
    return req<{
      start: string;
      end: string;
      rows: Array<{ channel: Channel; programs: Program[] }>;
      recordingByProgramId: Record<string, { id: string; status: string }>;
    }>(`/api/guide?${qs}`);
  },
  getNowPlaying: () =>
    req<{ items: Array<{ channel: Channel; current: Program | null; next: Program | null }> }>(
      '/api/guide/now',
    ),
  searchGuide: (q: string) =>
    req<{ programs: Program[] }>(`/api/guide/search?q=${encodeURIComponent(q)}`),
  importXmltv: (source: string) =>
    req<{ programCount: number; matchedChannelCount: number; scheduledFromPasses: number }>(
      '/api/guide/xmltv',
      { method: 'POST', body: JSON.stringify({ source }) },
    ),
  generateSampleGuide: (hours = 48) =>
    req<{ programCount: number; channelCount: number }>('/api/guide/sample', {
      method: 'POST',
      body: JSON.stringify({ hours }),
    }),

  startLive: (channelId: string) =>
    req<{ session: LiveSession }>('/api/live/start', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    }),
  heartbeatLive: (sessionId: string) =>
    req<{ session: LiveSession }>(`/api/live/${encodeURIComponent(sessionId)}/heartbeat`, {
      method: 'POST',
    }),
  stopLive: (sessionId: string) =>
    req<void>(`/api/live/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),

  getRecordings: (status?: string) =>
    req<{ recordings: Recording[] }>(
      status ? `/api/recordings?status=${encodeURIComponent(status)}` : '/api/recordings',
    ),
  getRecording: (id: string) =>
    req<{ recording: Recording; commercials: CommercialSegment[] }>(
      `/api/recordings/${encodeURIComponent(id)}`,
    ),
  scheduleProgram: (programId: string, opts?: { keepDays?: number; keepProtected?: boolean }) =>
    req<{ recording: Recording }>('/api/recordings/schedule', {
      method: 'POST',
      body: JSON.stringify({ programId, ...opts }),
    }),
  recordNow: (channelId: string, durationMinutes = 1, title?: string, keepDays?: number) =>
    req<{ recording: Recording }>('/api/recordings/now', {
      method: 'POST',
      body: JSON.stringify({ channelId, durationMinutes, title, keepDays }),
    }),
  updateRecordingRetention: (
    id: string,
    patch: { keepDays?: number; keepProtected?: boolean },
  ) =>
    req<{ recording: Recording }>(`/api/recordings/${encodeURIComponent(id)}/retention`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  stopRecording: (id: string) =>
    req<{ stopped: boolean }>(`/api/recordings/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  saveProgress: (id: string, positionSec: number, watched?: boolean) =>
    req<{ recording: Recording }>(`/api/recordings/${encodeURIComponent(id)}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ positionSec, watched }),
    }),
  scanCommercials: (id: string) =>
    req<{ commercials: CommercialSegment[] }>(
      `/api/recordings/${encodeURIComponent(id)}/scan-commercials`,
      { method: 'POST' },
    ),
  deleteRecording: (id: string) =>
    req<void>(`/api/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getSeriesPasses: () => req<{ seriesPasses: SeriesPass[] }>('/api/series-passes'),
  createSeriesPass: (payload: {
    title: string;
    channelId?: string | null;
    newOnly?: boolean;
    keepLimit?: number;
    keepDays?: number;
  }) =>
    req<{ seriesPass: SeriesPass; scheduledCount: number }>('/api/series-passes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSeriesPass: (id: string, patch: Partial<SeriesPass>) =>
    req<{ seriesPass: SeriesPass }>(`/api/series-passes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteSeriesPass: (id: string) =>
    req<void>(`/api/series-passes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getSettings: () =>
    req<{ settings: DvrSettings; capabilities: SystemCapabilities }>('/api/settings'),
  updateSettings: (patch: Partial<DvrSettings>) =>
    req<{ settings: DvrSettings; capabilities: SystemCapabilities }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  getCleanupStatus: () => req<CleanupStatus>('/api/cleanup/status'),
  runCleanup: (dryRun = false) =>
    req<{ report: CleanupReport; status: CleanupStatus }>('/api/cleanup/run', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),

  getApps: () => req<{ apps: StreamingApp[] }>('/api/apps'),
  addApp: (payload: {
    name: string;
    webUrl: string;
    tagline?: string;
    category?: string;
    androidPackage?: string;
    brandColor?: string;
    monogram?: string;
    pinned?: boolean;
  }) =>
    req<{ app: StreamingApp; apps: StreamingApp[] }>('/api/apps', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateApp: (id: string, patch: Partial<StreamingApp>) =>
    req<{ app: StreamingApp; apps: StreamingApp[] }>(`/api/apps/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteApp: (id: string) => req<void>(`/api/apps/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function getTitleScreenshotUrl(
  title: string,
  category = 'General',
  network = 'OTA',
  episodeNum?: string | null,
): string {
  const qs = new URLSearchParams({ title, category, network });
  if (episodeNum) qs.set('episode', episodeNum);
  return `/api/artwork?${qs.toString()}`;
}

export function getProgramScreenshotUrl(program: Program | null, channel: Channel): string {
  if (program?.posterUrl) return program.posterUrl;
  return getTitleScreenshotUrl(
    program?.title ?? `${channel.guideName} Live`,
    program?.category ?? 'General',
    channel.network || channel.guideName,
    program?.episodeNum,
  );
}

export function getRecordingScreenshotUrl(recording: Recording): string {
  return `/api/recordings/${encodeURIComponent(recording.id)}/thumbnail`;
}

export const RETENTION_OPTIONS = [
  { value: 7, label: '7 Days' },
  { value: 14, label: '14 Days' },
  { value: 30, label: '30 Days' },
  { value: 60, label: '60 Days' },
  { value: 90, label: '90 Days' },
  { value: 365, label: '1 Year' },
  { value: 0, label: 'Keep Forever' },
];

export function formatRetention(keepDays: number, keepProtected?: boolean): string {
  if (keepProtected) return 'Locked';
  if (keepDays <= 0) return 'Keep Forever';
  if (keepDays === 365) return 'Save 1y';
  return `Save ${keepDays}d`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
