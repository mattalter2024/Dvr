import { useMemo } from 'react';
import { CircleDot, ExternalLink, Tv } from 'lucide-react';
import {
  formatDuration,
  formatTime,
  getProgramScreenshotUrl,
  getRecordingScreenshotUrl,
  type Channel,
  type HealthResponse,
  type Program,
  type Recording,
  type StreamingApp,
} from '../api/client';
import { playTivoRecordTone, playTivoSelectChime } from '../utils/tivoSounds';

interface HomePageProps {
  health: HealthResponse | null;
  nowPlaying: Array<{ channel: Channel; current: Program | null; next: Program | null }>;
  recordings: Recording[];
  apps: StreamingApp[];
  onWatchLive: (channel: Channel) => void;
  onPlayRecording: (recording: Recording) => void;
  onQuickTestRecord: (channel: Channel) => void;
  onOpenGuide: () => void;
  onOpenApps: () => void;
}

export function HomePage({
  health,
  nowPlaying,
  recordings,
  apps,
  onWatchLive,
  onPlayRecording,
  onQuickTestRecord,
  onOpenGuide,
  onOpenApps,
}: HomePageProps) {
  // Rank channels by real watch frequency, then most recently watched, then favorites
  const frequentChannels = useMemo(() => {
    return nowPlaying
      .slice()
      .sort((a, b) => {
        const countDiff = (b.channel.watchCount ?? 0) - (a.channel.watchCount ?? 0);
        if (countDiff !== 0) return countDiff;
        const lastA = a.channel.lastWatchedAt ? Date.parse(a.channel.lastWatchedAt) : 0;
        const lastB = b.channel.lastWatchedAt ? Date.parse(b.channel.lastWatchedAt) : 0;
        if (lastB !== lastA) return lastB - lastA;
        if (a.channel.favorite !== b.channel.favorite) return a.channel.favorite ? -1 : 1;
        return Number.parseFloat(a.channel.guideNumber) - Number.parseFloat(b.channel.guideNumber);
      })
      .slice(0, 4);
  }, [nowPlaying]);

  // Latest recordings: active captures first, followed by newest completed recordings
  const latestRecordings = useMemo(() => {
    const active = recordings.filter((r) => r.status === 'recording');
    const completed = recordings
      .filter((r) => r.status === 'completed')
      .sort((a, b) => Date.parse(b.actualStart ?? b.scheduledStart) - Date.parse(a.actualStart ?? a.scheduledStart));
    return [...active, ...completed].slice(0, 8);
  }, [recordings]);

  const pinnedApps = apps.filter((a) => a.pinned);
  const toDoQueue = recordings
    .filter((r) => r.status === 'scheduled' || r.status === 'conflict')
    .slice(0, 4);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Home</h1>
          <p className="page-subtitle">
            {nowPlaying.length} OTA channels
            {health && !health.capabilities.ffmpegAvailable
              ? ' · Simulation mode (install FFmpeg or use Docker for live video)'
              : ''}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {frequentChannels[0] && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                playTivoRecordTone();
                onQuickTestRecord(frequentChannels[0].channel);
              }}
            >
              <CircleDot size={14} color="var(--rec-red)" /> 1-Min Test Recording
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              playTivoSelectChime();
              onOpenGuide();
            }}
          >
            <Tv size={14} /> Open Guide
          </button>
        </div>
      </div>

      {/* 1. Frequent Channels (Top) */}
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2 className="section-heading" style={{ marginBottom: 0 }}>
            Frequent Channels
          </h2>
          <button
            className="btn btn-secondary"
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={onOpenGuide}
          >
            All {nowPlaying.length} Channels →
          </button>
        </div>

        <div className="card-grid">
          {frequentChannels.map(({ channel, current, next }) => (
            <button
              key={channel.id}
              className="channel-card"
              onClick={() => {
                playTivoSelectChime();
                onWatchLive(channel);
              }}
            >
              <div className="show-shot-wrap">
                <img
                  src={getProgramScreenshotUrl(current, channel)}
                  alt={current?.title ?? channel.guideName}
                  className="show-shot-img"
                  loading="lazy"
                />
                <div className="show-shot-overlay">
                  <span
                    className="pill"
                    style={{ background: 'rgba(7, 11, 20, 0.78)', color: '#e2e8f0' }}
                  >
                    {channel.guideNumber} {channel.guideName}
                  </span>
                  {current?.isLive ? (
                    <span
                      className="pill pill-live"
                      style={{ background: 'rgba(127, 29, 29, 0.85)' }}
                    >
                      Live
                    </span>
                  ) : (channel.watchCount ?? 0) > 0 ? (
                    <span
                      className="pill"
                      style={{ background: 'rgba(7, 11, 20, 0.75)', color: '#93c5fd' }}
                    >
                      {channel.watchCount}× tuned
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="channel-card-body">
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {current?.title ?? 'Live OTA Broadcast'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {current
                    ? `${formatTime(current.startTime)} – ${formatTime(current.endTime)}`
                    : channel.network}
                </div>
                {next && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Next: {next.title}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 2. Latest Recordings (Directly Below Frequent Channels) */}
      <section>
        <h2 className="section-heading">Latest Recordings</h2>
        {latestRecordings.length === 0 ? (
          <div className="card" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            No recordings yet. Start a 1-minute test recording above or pick a show in the Guide.
          </div>
        ) : (
          <div className="card-grid">
            {latestRecordings.map((rec) => {
              const isRecordingNow = rec.status === 'recording';
              const pct =
                rec.durationSec > 0
                  ? Math.min(100, (rec.watchedPositionSec / rec.durationSec) * 100)
                  : 0;
              const statusDotClass = isRecordingNow
                ? 'rec'
                : rec.watchedPositionSec > 5 && !rec.watched
                  ? 'partial'
                  : 'live';

              return (
                <button
                  key={rec.id}
                  className="channel-card"
                  onClick={() => {
                    playTivoSelectChime();
                    onPlayRecording(rec);
                  }}
                >
                  <div className="show-shot-wrap">
                    <img
                      src={getRecordingScreenshotUrl(rec)}
                      alt={rec.title}
                      className="show-shot-img"
                      loading="lazy"
                    />
                    <div className="show-shot-overlay">
                      {isRecordingNow ? (
                        <span
                          className="pill pill-live"
                          style={{ background: 'rgba(127, 29, 29, 0.85)' }}
                        >
                          Recording · {rec.channelNumber}
                        </span>
                      ) : (
                        <span
                          className="pill"
                          style={{ background: 'rgba(7, 11, 20, 0.78)', color: '#e2e8f0' }}
                        >
                          <span className={`dot ${statusDotClass}`} /> {rec.channelNumber}
                        </span>
                      )}
                      {rec.commercialCount > 0 && (
                        <span
                          className="pill pill-skip"
                          style={{ background: 'rgba(6, 78, 59, 0.85)' }}
                        >
                          Skip ({rec.commercialCount})
                        </span>
                      )}
                    </div>
                    {pct > 0 && (
                      <div className="show-shot-progress">
                        <div className="show-shot-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="channel-card-body">
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{rec.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {rec.episodeNum ? `${rec.episodeNum} · ` : ''}
                      {formatDuration(rec.durationSec)} · {rec.channelName}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Streaming Apps Quick Row */}
      {pinnedApps.length > 0 && (
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <h2 className="section-heading" style={{ marginBottom: 0 }}>
              Streaming Apps
            </h2>
            <button
              className="btn btn-secondary"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={onOpenApps}
            >
              Manage Apps
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: 12,
            }}
          >
            {pinnedApps.map((app) => (
              <button
                key={app.id}
                className="channel-card"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: '12px 14px',
                  gap: 12,
                }}
                onClick={() => {
                  playTivoSelectChime();
                  window.open(app.webUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: `linear-gradient(145deg, ${app.brandColor}55, #0c1220)`,
                    border: '1px solid var(--border-subtle)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: app.monogram.length > 3 ? 11 : 15,
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    flexShrink: 0,
                  }}
                >
                  {app.monogram}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{app.name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {app.category}
                  </div>
                </div>
                <ExternalLink size={14} color="var(--text-muted)" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 4. Up Next on To Do List */}
      {toDoQueue.length > 0 && (
        <section>
          <h2 className="section-heading">Up Next on To Do List</h2>
          <div className="card-grid">
            {toDoQueue.map((rec) => (
              <div
                key={rec.id}
                className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}
              >
                <div className="show-thumb-inline" style={{ width: 92, height: 52 }}>
                  <img
                    src={getRecordingScreenshotUrl(rec)}
                    alt={rec.title}
                    className="show-shot-img"
                    loading="lazy"
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Ch {rec.channelNumber} · {formatTime(rec.scheduledStart)}
                    </span>
                    <span className={rec.status === 'conflict' ? 'pill pill-ad' : 'tivo-rec-badge'}>
                      {rec.status === 'conflict' ? 'Conflict' : rec.seriesPassId ? 'RR' : 'R'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      marginTop: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {rec.title}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
