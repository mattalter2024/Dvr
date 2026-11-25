import { CircleDot, Play, Scissors, Tv, Zap } from 'lucide-react';
import {
  formatDuration,
  formatTime,
  type Channel,
  type HealthResponse,
  type Program,
  type Recording,
} from '../api/client';

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
  const continueWatching = recordings
    .filter((r) => r.status === 'completed')
    .slice(0, 6);
  const upcoming = recordings
    .filter((r) => r.status === 'scheduled' || r.status === 'conflict')
    .slice(0, 4);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Whole-House OTA DVR</h1>
          <p className="page-subtitle">
            Live Over-the-Air TV · Automatic Commercial Skipping · Multi-Room Streaming
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {nowPlaying[0] && (
            <button
              className="btn btn-amber"
              onClick={() => onQuickTestRecord(nowPlaying[0].channel)}
            >
              <Zap size={16} /> 1-Min Test Recording ({nowPlaying[0].channel.guideNumber})
            </button>
          )}
          <button className="btn btn-primary" onClick={onOpenGuide}>
            <Tv size={16} /> Open Full TV Guide
          </button>
        </div>
      </div>

      {/* System Capability Banner */}
      {health && (!health.capabilities.ffmpegAvailable || !health.capabilities.comskipAvailable) && (
        <div
          className="card"
          style={{
            borderColor: 'rgba(245, 158, 11, 0.45)',
            background: 'rgba(245, 158, 11, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: '#fcd34d', marginBottom: 4 }}>
              Host Media Engine Status
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              FFmpeg: <strong>{health.capabilities.ffmpegAvailable ? 'Ready' : 'Not detected (Simulation mode active)'}</strong>{' '}
              · Comskip:{' '}
              <strong>
                {health.capabilities.comskipAvailable
                  ? 'Ready'
                  : 'Using built-in FFmpeg black/silence commercial detector'}
              </strong>{' '}
              — Run <code>docker compose up</code> to bundle FFmpeg + Comskip automatically.
            </div>
          </div>
        </div>
      )}

      {/* Active Recordings Strip */}
      {activeRecs.length > 0 && (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="dot rec" /> Recording Now
          </h2>
          <div className="card-grid">
            {activeRecs.map((rec) => (
              <button
                key={rec.id}
                className="channel-card"
                style={{ borderColor: 'rgba(239, 68, 68, 0.45)' }}
                onClick={() => onPlayRecording(rec)}
              >
                <div className="channel-badge-row">
                  <span className="pill pill-live">● REC · CH {rec.channelNumber}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {formatDuration(rec.durationSec)} captured
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{rec.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Watch from start (Chase-Play)
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* On Air Now */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>On Air Now</h2>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {nowPlaying.length} OTA channels ready
          </span>
        </div>
        <div className="card-grid">
          {nowPlaying.map(({ channel, current, next }) => (
            <button
              key={channel.id}
              className="channel-card"
              onClick={() => onWatchLive(channel)}
            >
              <div className="channel-badge-row">
                <div>
                  <span className="channel-num">{channel.guideNumber}</span>{' '}
                  <span className="channel-name">{channel.guideName}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {channel.hd && <span className="pill pill-hd">HD</span>}
                  {current?.isLive && <span className="pill pill-live">LIVE</span>}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
                  {current?.title ?? 'Live OTA Broadcast'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {current
                    ? `${formatTime(current.startTime)} – ${formatTime(current.endTime)}`
                    : channel.network}
                </div>
              </div>

              {next && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: 8,
                  }}
                >
                  Up Next ({formatTime(next.startTime)}): {next.title}
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Recent DVR Recordings */}
      <section>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          Recent Recordings (Ad-Free Ready)
        </h2>
        {continueWatching.length === 0 ? (
          <div className="card" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            No completed recordings yet. Click <strong>1-Min Test Recording</strong> above or pick any
            show in the <strong>Live TV Guide</strong> to record and automatically detect commercial breaks.
          </div>
        ) : (
          <div className="card-grid">
            {continueWatching.map((rec) => {
              const pct =
                rec.durationSec > 0
                  ? Math.min(100, (rec.watchedPositionSec / rec.durationSec) * 100)
                  : 0;
              return (
                <button
                  key={rec.id}
                  className="channel-card"
                  onClick={() => onPlayRecording(rec)}
                >
                  <div className="channel-badge-row">
                    <span className="pill pill-hd">
                      {rec.channelNumber} {rec.channelName}
                    </span>
                    {rec.commercialCount > 0 && (
                      <span className="pill pill-ad">
                        <Scissors size={11} /> {rec.commercialCount} ads marked
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{rec.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {rec.episodeNum ? `${rec.episodeNum} · ` : ''}
                    {formatDuration(rec.durationSec)}
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>
                    <Play size={14} /> {rec.watchedPositionSec > 5 ? 'Resume Playback' : 'Watch Now'}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Upcoming Queue Preview */}
      {upcoming.length > 0 && (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Upcoming Recordings</h2>
          <div className="card-grid">
            {upcoming.map((rec) => (
              <div key={rec.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="pill pill-hd">CH {rec.channelNumber}</span>
                  <span className={`pill ${rec.status === 'conflict' ? 'pill-ad' : 'pill-live'}`}>
                    <CircleDot size={11} /> {rec.status}
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{rec.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {formatTime(rec.scheduledStart)} – {formatTime(rec.scheduledEnd)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
