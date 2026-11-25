export type TunerType = 'hdhomerun' | 'virtual';

export interface TunerDevice {
  id: string;
  name: string;
  type: TunerType;
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
  ownerId: string; // recordingId or liveSessionId
  clientCount: number;
  startedAt: string;
}

export interface Channel {
  id: string;
  tunerId: string;
  guideNumber: string; // e.g. "4.1"
  guideName: string;   // e.g. "WCCO-HD"
  network: string;     // e.g. "CBS"
  streamUrl: string;
  logoUrl: string | null;
  xmltvId: string | null;
  hd: boolean;
  favorite: boolean;
  enabled: boolean;
}

export interface Program {
  id: string;
  channelId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  startTime: string; // ISO-8601 UTC
  endTime: string;   // ISO-8601 UTC
  category: string;
  episodeNum: string | null; // e.g. "S04E12"
  seriesId: string | null;
  posterUrl: string | null;
  isNew: boolean;
  isLive: boolean;
  rating: string | null;
}

export type RecordingStatus =
  | 'scheduled'
  | 'recording'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'conflict';

export type CommercialScanStatus =
  | 'pending'
  | 'scanning'
  | 'completed'
  | 'failed'
  | 'skipped';

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
  status: RecordingStatus;
  errorMessage: string | null;
  filePath: string | null;
  fileSizeBytes: number;
  durationSec: number;
  thumbnailPath: string | null;
  commercialScanStatus: CommercialScanStatus;
  commercialCount: number;
  watchedPositionSec: number;
  watched: boolean;
  createdAt: string;
}

export interface SeriesPass {
  id: string;
  title: string;
  channelId: string | null; // null = any channel
  newOnly: boolean;
  paddingStartMin: number;
  paddingEndMin: number;
  keepLimit: number; // 0 = keep all
  priority: number;
  enabled: boolean;
  createdAt: string;
}

export interface DvrSettings {
  serverName: string;
  xmltvUrl: string;
  xmltvRefreshHours: number;
  defaultPaddingStartMin: number;
  defaultPaddingEndMin: number;
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

export interface WsEvent {
  type:
    | 'tuner_update'
    | 'recording_started'
    | 'recording_progress'
    | 'recording_completed'
    | 'recording_failed'
    | 'commercials_scanned'
    | 'guide_updated'
    | 'schedule_updated';
  payload: unknown;
  timestamp: string;
}
