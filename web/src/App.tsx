import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  api,
  type Channel,
  type HealthResponse,
  type Program,
  type Recording,
  type SeriesPass,
  type StreamingApp,
  type TunerUtilization,
} from './api/client';
import { TvNavRail, type NavTab } from './components/TvNavRail';
import type { PlayerTarget } from './components/VideoPlayer';
import { useTvNavigation } from './hooks/useTvNavigation';
import { HomePage } from './pages/HomePage';
import { GuidePage } from './pages/GuidePage';
import { RecordingsPage } from './pages/RecordingsPage';
import { AppsPage } from './pages/AppsPage';
import { SchedulePage } from './pages/SchedulePage';
import { SettingsPage } from './pages/SettingsPage';

// Lazy-load VideoPlayer (and its ~500kB hls.js engine) only when playback actually starts!
const VideoPlayer = lazy(() =>
  import('./components/VideoPlayer').then((m) => ({ default: m.VideoPlayer })),
);

function upsertRecording(list: Recording[], updated: Recording): Recording[] {
  const idx = list.findIndex((r) => r.id === updated.id);
  if (idx === -1) return [updated, ...list];
  const next = list.slice();
  next[idx] = updated;
  return next;
}

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [tuners, setTuners] = useState<TunerUtilization[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [nowPlaying, setNowPlaying] = useState<
    Array<{ channel: Channel; current: Program | null; next: Program | null }>
  >([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [seriesPasses, setSeriesPasses] = useState<SeriesPass[]>([]);
  const [apps, setApps] = useState<StreamingApp[]>([]);
  const [autoSkipDefault, setAutoSkipDefault] = useState(true);
  const [playerTarget, setPlayerTarget] = useState<PlayerTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useTvNavigation(playerTarget !== null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [h, t, ch, np, rec, sp, st, appRes] = await Promise.all([
        api.health(),
        api.getTuners(),
        api.getChannels(),
        api.getNowPlaying(),
        api.getRecordings(),
        api.getSeriesPasses(),
        api.getSettings(),
        api.getApps(),
      ]);
      setHealth(h);
      setTuners(t.tuners);
      setChannels(ch.channels);
      setNowPlaying(np.items);
      setRecordings(rec.recordings);
      setSeriesPasses(sp.seriesPasses);
      setAutoSkipDefault(st.settings.autoSkipCommercialsDefault);
      setApps(appRes.apps);
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      console.error('Failed to refresh DVR state:', err);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Surgical WebSocket state updates + automatic reconnect with backoff (avoids HTTP storms!)
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retryMs = 1000;
    let retryTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        retryMs = 1000;
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type?: string; payload?: unknown };
          switch (msg.type) {
            case 'tuner_update':
              if (Array.isArray(msg.payload)) {
                setTuners(msg.payload as TunerUtilization[]);
              }
              break;
            case 'recording_started':
            case 'recording_progress':
            case 'recording_completed':
            case 'recording_failed':
              if (msg.payload && typeof msg.payload === 'object' && 'id' in msg.payload) {
                setRecordings((prev) => upsertRecording(prev, msg.payload as Recording));
              }
              break;
            case 'commercials_scanned':
              if (msg.payload && typeof msg.payload === 'object') {
                const { recordingId, count } = msg.payload as {
                  recordingId?: string;
                  count?: number;
                };
                if (recordingId) {
                  setRecordings((prev) =>
                    prev.map((r) =>
                      r.id === recordingId
                        ? {
                            ...r,
                            commercialScanStatus: 'completed',
                            commercialCount: count ?? r.commercialCount,
                          }
                        : r,
                    ),
                  );
                }
              }
              break;
            case 'guide_updated':
              void api.getNowPlaying().then((np) => setNowPlaying(np.items));
              setRefreshSignal((s) => s + 1);
              break;
            case 'schedule_updated':
              void Promise.all([api.getRecordings(), api.getSeriesPasses()]).then(([rec, sp]) => {
                setRecordings(rec.recordings);
                setSeriesPasses(sp.seriesPasses);
                setRefreshSignal((s) => s + 1);
              });
              break;
            case 'apps_updated':
              if (Array.isArray(msg.payload)) {
                setApps(msg.payload as StreamingApp[]);
              }
              break;
            default:
              void refreshAll();
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (closed) return;
        retryTimer = window.setTimeout(() => {
          retryMs = Math.min(15_000, retryMs * 2);
          connect();
        }, retryMs);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [refreshAll]);

  const handleRecordEpisode = async (program: Program) => {
    try {
      await api.scheduleProgram(program.id);
      notify(`Scheduled recording: "${program.title}"`);
      const rec = await api.getRecordings();
      setRecordings(rec.recordings);
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to schedule recording');
    }
  };

  const handleCreateSeriesPass = async (program: Program, newOnly: boolean) => {
    try {
      const res = await api.createSeriesPass({
        title: program.title,
        channelId: program.channelId,
        newOnly,
      });
      notify(`OnePass saved for "${program.title}" (${res.scheduledCount} episodes scheduled)`);
      const [rec, sp] = await Promise.all([api.getRecordings(), api.getSeriesPasses()]);
      setRecordings(rec.recordings);
      setSeriesPasses(sp.seriesPasses);
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to create OnePass');
    }
  };

  const handleQuickTestRecord = async (channel: Channel) => {
    try {
      const { recording } = await api.recordNow(
        channel.id,
        1,
        `${channel.guideName} 1-Min Commercial Skip Test`,
      );
      setRecordings((prev) => upsertRecording(prev, recording));
      notify(`Recording "${recording.title}" for 1 minute — commercial scan runs automatically`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to start recording');
    }
  };

  const activeRecordingsCount = recordings.filter((r) => r.status === 'recording').length;

  return (
    <div className="app-shell">
      <TvNavRail
        activeTab={activeTab}
        onSelect={setActiveTab}
        activeRecordingsCount={activeRecordingsCount}
        tuners={tuners}
        serverName={health?.serverName ?? 'AirVault Home DVR'}
      />

      <main className="main-stage">
        {activeTab === 'home' && (
          <HomePage
            health={health}
            nowPlaying={nowPlaying}
            recordings={recordings}
            apps={apps}
            onWatchLive={(channel) => setPlayerTarget({ kind: 'live', channel })}
            onPlayRecording={(recording) => setPlayerTarget({ kind: 'recording', recording })}
            onQuickTestRecord={(channel) => void handleQuickTestRecord(channel)}
            onOpenGuide={() => setActiveTab('guide')}
            onOpenApps={() => setActiveTab('apps')}
          />
        )}

        {activeTab === 'apps' && (
          <AppsPage apps={apps} onAppsChanged={setApps} onNotify={notify} />
        )}

        {activeTab === 'guide' && (
          <GuidePage
            onWatchLive={(channel) => setPlayerTarget({ kind: 'live', channel })}
            onRecordEpisode={handleRecordEpisode}
            onCreateSeriesPass={handleCreateSeriesPass}
            refreshSignal={refreshSignal}
          />
        )}

        {activeTab === 'recordings' && (
          <RecordingsPage
            recordings={recordings}
            onPlay={(recording) => setPlayerTarget({ kind: 'recording', recording })}
            onRefresh={() => void refreshAll()}
            onNotify={notify}
          />
        )}

        {activeTab === 'schedule' && (
          <SchedulePage
            recordings={recordings}
            seriesPasses={seriesPasses}
            onRefresh={() => void refreshAll()}
            onNotify={notify}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPage
            tuners={tuners}
            onRefresh={() => void refreshAll()}
            onNotify={notify}
          />
        )}
      </main>

      {playerTarget && (
        <Suspense
          fallback={
            <div className="player-overlay" style={{ display: 'grid', placeItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Loading player...</span>
            </div>
          }
        >
          <VideoPlayer
            target={playerTarget}
            channels={channels}
            autoSkipDefault={autoSkipDefault}
            onClose={() => {
              const wasLive = playerTarget?.kind === 'live';
              setPlayerTarget(null);
              if (wasLive) {
                void api.getNowPlaying().then((np) => setNowPlaying(np.items));
              } else {
                void api.getRecordings().then((r) => setRecordings(r.recordings));
              }
            }}
            onSwitchChannel={(channel) => setPlayerTarget({ kind: 'live', channel })}
            onRecordNow={(channel) => {
              void api
                .recordNow(channel.id, 30)
                .then(({ recording }) => {
                  setRecordings((prev) => upsertRecording(prev, recording));
                  notify(`Started recording ${channel.guideNumber} ${channel.guideName}`);
                })
                .catch((err) => notify(err instanceof Error ? err.message : 'Record failed'));
            }}
          />
        </Suspense>
      )}

      {toast && <div className="toast-banner">{toast}</div>}
    </div>
  );
}

export default App;
