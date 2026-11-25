import { CircleDot, Tv } from 'lucide-react';
import {
  formatDuration,
  formatTime,
  getProgramScreenshotUrl,
  getRecordingScreenshotUrl,
  type Channel,
  type HealthResponse,
  type Program,
  type Recording,
} from '../api/client';
import { playTivoRecordTone, playTivoSelectChime } from '../utils/tivoSounds';

interface HomePageProps {
  health: HealthResponse | null;
  nowPlaying: Array<{ channel: Channel; current: Program | null; next: Program | null }>;
  recordings: Recording[];
  onWatchLive: (channel: Channel) => void;
  onPlayRecording: (recording: Recording) => void;
  onQuickTestRecord: (channel: Channel) => void;
  onOpenGuide: () => void;
}

export function HomePage({
  health,
  nowPlaying,
  recordings,
  onWatchLive,
  onPlayRecording,
  onQuickTestRecord,
  onOpenGuide,
}: HomePageProps) {
  const activeRecs = recordings.filter((r) => r.status === 'recording');
  const myShowsRecent = recordings.filter((r) => r.status === 'completed').slice(0, 6);
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
          {nowPlaying[0] && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                playTivoRecordTone();
                onQuickTestRecord(nowPlaying[0].channel);
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

      {/* Currently Recording */}
      {activeRecs.length > 0 && (
        <section>
          <h2 className="section-heading">
            <span className="dot rec" /> Recording Now
          </h2>
          <div className="card-grid">
            {activeRecs.map((rec) => (
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
                    <span className="pill pill-live" style={{ background: 'rgba(127, 29, 29, 0.85)' }}>
                      Recording · {rec.channelNumber}
                    </span>
                    <span
                      className="pill"
                      style={{ background: 'rgba(7, 11, 20, 0.78)', color: '#cbd5e1' }}
                    >
                      {formatDuration(rec.durationSec)}
                    </span>
                  </div>
                </div>
                <div className="channel-card-body">
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{rec.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Watch from start
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* My Shows */}
      <section>
        <h2 className="section-heading">My Shows</h2>
        {myShowsRecent.length === 0 ? (
          <div className="card" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            No recordings yet. Start a 1-minute test recording above or pick a show in the Guide.
          </div>
        ) : (
          <div className="card-grid">
            {myShowsRecent.map((rec) => {
              const pct =
                rec.durationSec > 0
                  ? Math.min(100, (rec.watchedPositionSec / rec.durationSec) * 100)
                  : 0;
              const statusDotClass =
                rec.watchedPositionSec > 5 && !rec.watched ? 'partial' : 'live';

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
                      <span
                        className="pill"
                        style={{ background: 'rgba(7, 11, 20, 0.78)', color: '#e2e8f0' }}
                      >
                        <span className={`dot ${statusDotClass}`} /> {rec.channelNumber}
                      </span>
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

      {/* Live Now */}
      <section>
        <h2 className="section-heading">On Now</h2>
        <div className="card-grid">
          {nowPlaying.map(({ channel, current, next }) => (
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
                  {current?.isLive && (
                    <span className="pill pill-live" style={{ background: 'rgba(127, 29, 29, 0.85)' }}>
                      Live
                    </span>
                  )}
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

      {/* To Do Queue */}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
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
