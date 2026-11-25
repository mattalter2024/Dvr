import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Channel,
  type HealthResponse,
  type Program,
  type Recording,
  type SeriesPass,
  type TunerUtilization,
} from './api/client';
import { TvNavRail, type NavTab } from './components/TvNavRail';
import { VideoPlayer, type PlayerTarget } from './components/VideoPlayer';
import { useTvNavigation } from './hooks/useTvNavigation';
import { HomePage } from './pages/HomePage';
import { GuidePage } from './pages/GuidePage';
import { RecordingsPage } from './pages/RecordingsPage';
import { SchedulePage } from './pages/SchedulePage';
import { SettingsPage } from './pages/SettingsPage';

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
  const [autoSkipDefault, setAutoSkipDefault] = useState(true);
  const [playerTarget, setPlayerTarget] = useState<PlayerTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Enable spatial D-pad TV navigation when fullscreen player is closed
  useTvNavigation(playerTarget !== null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [h, t, ch, np, rec, sp, st] = await Promise.all([
        api.health(),
        api.getTuners(),
        api.getChannels(),
        api.getNowPlaying(),
        api.getRecordings(),
        api.getSeriesPasses(),
        api.getSettings(),
      ]);
      setHealth(h);
      setTuners(t.tuners);
      setChannels(ch.channels);
      setNowPlaying(np.items);
      setRecordings(rec.recordings);
      setSeriesPasses(sp.seriesPasses);
      setAutoSkipDefault(st.settings.autoSkipCommercialsDefault);
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      console.error('Failed to refresh DVR state:', err);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Real-time WebSocket updates for whole-house live tuner & recording events
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onmessage = () => {
      void refreshAll();
    };
    return () => ws.close();
  }, [refreshAll]);

  const handleRecordEpisode = async (program: Program) => {
    try {
      await api.scheduleProgram(program.id);
      notify(`Scheduled recording: "${program.title}"`);
      await refreshAll();
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
      notify(`Series Pass saved for "${program.title}" (${res.scheduledCount} episodes scheduled)`);
      await refreshAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to create Series Pass');
    }
  };

  const handleQuickTestRecord = async (channel: Channel) => {
    try {
      const { recording } = await api.recordNow(
        channel.id,
        1,
        `${channel.guideName} 1-Min Commercial Skip Test`,
      );
      notify(`Recording "${recording.title}" for 1 minute — commercial scan will run automatically!`);
      await refreshAll();
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
            onWatchLive={(channel) => setPlayerTarget({ kind: 'live', channel })}
            onPlayRecording={(recording) => setPlayerTarget({ kind: 'recording', recording })}
            onQuickTestRecord={(channel) => void handleQuickTestRecord(channel)}
            onOpenGuide={() => setActiveTab('guide')}
          />
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
        <VideoPlayer
          target={playerTarget}
          channels={channels}
          autoSkipDefault={autoSkipDefault}
          onClose={() => {
            setPlayerTarget(null);
            void refreshAll();
          }}
          onSwitchChannel={(channel) => setPlayerTarget({ kind: 'live', channel })}
          onRecordNow={(channel) => {
            void api
              .recordNow(channel.id, 30)
              .then(() => {
                notify(`Started recording ${channel.guideNumber} ${channel.guideName}`);
                void refreshAll();
              })
              .catch((err) => notify(err instanceof Error ? err.message : 'Record failed'));
          }}
        />
      )}

      {toast && <div className="toast-banner">{toast}</div>}
    </div>
  );
}

export default App;
