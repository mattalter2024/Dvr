import { CircleDot, Play, Tv } from 'lucide-react';
import {
  formatDuration,
  formatTime,
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
                <div className="channel-badge-row">
                  <span className="pill pill-live">Recording · {rec.channelNumber}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {formatDuration(rec.durationSec)}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{rec.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Watch from start
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
                  <div className="channel-badge-row">
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span className={`dot ${statusDotClass}`} />
                      {rec.channelNumber} {rec.channelName}
                    </span>
                    {rec.commercialCount > 0 && (
                      <span className="pill pill-skip">Skip ({rec.commercialCount})</span>
                    )}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{rec.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {rec.episodeNum ? `${rec.episodeNum} · ` : ''}
                    {formatDuration(rec.durationSec)}
                  </div>
                  {pct > 0 && (
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
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
              <div className="channel-badge-row">
                <div>
                  <span className="channel-num">{channel.guideNumber}</span>{' '}
                  <span className="channel-name">{channel.guideName}</span>
                </div>
                {current?.isLive && <span className="pill pill-live">Live</span>}
              </div>

              <div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
                  {current?.title ?? 'Live OTA Broadcast'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {current
                    ? `${formatTime(current.startTime)} – ${formatTime(current.endTime)}`
                    : channel.network}
                </div>
              </div>

              {next && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Next: {next.title}
                </div>
              )}
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
                style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 15 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Ch {rec.channelNumber} · {formatTime(rec.scheduledStart)}
                  </span>
                  <span className={rec.status === 'conflict' ? 'pill pill-ad' : 'tivo-rec-badge'}>
                    {rec.status === 'conflict' ? 'Conflict' : rec.seriesPassId ? 'RR' : 'R'}
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{rec.title}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
