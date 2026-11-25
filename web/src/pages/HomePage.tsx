import { CircleDot, Film, Play, Tv, Zap } from 'lucide-react';
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
      {/* Iconic TiVo Central Hero Banner */}
      <div className="tivo-hero-bar">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="pill pill-skip">
              <Zap size={12} /> SKIPMODE™ READY
            </span>
            <span className="pill pill-hd">{nowPlaying.length} OTA CHANNELS</span>
            {activeRecs.length > 0 && (
              <span className="pill pill-live">● {activeRecs.length} RECORDING NOW</span>
            )}
          </div>
          <h1 className="page-title">TiVo Central</h1>
          <p className="page-subtitle">
            Whole-House Over-the-Air DVR · One-Click Commercial Skip · Multi-Room Live TV
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {nowPlaying[0] && (
            <button
              className="btn btn-skip"
              onClick={() => {
                playTivoRecordTone();
                onQuickTestRecord(nowPlaying[0].channel);
              }}
            >
              <Zap size={16} /> 1-Min SkipMode Test ({nowPlaying[0].channel.guideNumber})
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              playTivoSelectChime();
              onOpenGuide();
            }}
          >
            <Tv size={16} /> Live TV Guide
          </button>
        </div>
      </div>

      {/* Host Media Engine Notice (if FFmpeg or Comskip missing locally) */}
      {health && (!health.capabilities.ffmpegAvailable || !health.capabilities.comskipAvailable) && (
        <div
          className="card"
          style={{
            borderColor: 'rgba(250, 204, 21, 0.45)',
            background: 'rgba(15, 38, 86, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            padding: '14px 20px',
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong style={{ color: '#facc15' }}>Media Engine:</strong> FFmpeg{' '}
            <strong>
              {health.capabilities.ffmpegAvailable ? 'Ready' : 'Not detected (Simulation active)'}
            </strong>{' '}
            · Comskip{' '}
            <strong>
              {health.capabilities.comskipAvailable
                ? 'Ready'
                : 'Using built-in FFmpeg commercial detector'}
            </strong>{' '}
            — Run <code>docker compose up</code> to bundle FFmpeg + Comskip automatically.
          </div>
        </div>
      )}

      {/* Currently Recording (Red Dot Chase-Play Strip) */}
      {activeRecs.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 800,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
            }}
          >
            <span className="dot rec" /> Currently Recording (Chase-Play)
          </h2>
          <div className="card-grid">
            {activeRecs.map((rec) => (
              <button
                key={rec.id}
                className="channel-card"
                style={{ borderColor: 'rgba(239, 68, 68, 0.7)' }}
                onClick={() => {
                  playTivoSelectChime();
                  onPlayRecording(rec);
                }}
              >
                <div className="channel-badge-row">
                  <span className="pill pill-live">● REC · CH {rec.channelNumber}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {formatDuration(rec.durationSec)}
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{rec.title}</div>
                <div style={{ fontSize: 13, color: '#86efac', fontWeight: 600 }}>
                  ▶ Watch from beginning while recording
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* My Shows Quick Strip */}
      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Film size={18} color="#22c55e" /> My Shows — Ready to Watch
          </h2>
        </div>

        {myShowsRecent.length === 0 ? (
          <div className="card" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Your My Shows list is empty. Click <strong>1-Min SkipMode Test</strong> above or pick any
            program in the <strong>Live TV Guide</strong> to record and automatically tag commercial
            breaks.
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <span className={`dot ${statusDotClass}`} />
                      <span className="pill pill-hd">
                        {rec.channelNumber} {rec.channelName}
                      </span>
                    </span>
                    {rec.commercialCount > 0 && (
                      <span className="pill pill-skip">
                        <Zap size={10} /> SKIP ({rec.commercialCount})
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{rec.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {rec.episodeNum ? `${rec.episodeNum} · ` : ''}
                    {formatDuration(rec.durationSec)}
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: '#facc15',
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    <Play size={14} /> {rec.watchedPositionSec > 5 ? 'Resume Show' : 'Watch Ad-Free'}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* What to Watch Now — Live OTA Channels */}
      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>What to Watch Now — Live OTA</h2>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Select any channel to tune live
          </span>
        </div>
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
                <div style={{ display: 'flex', gap: 6 }}>
                  {channel.hd && <span className="pill pill-hd">HD</span>}
                  {current?.isLive && <span className="pill pill-live">LIVE</span>}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
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
                    borderTop: '1px solid var(--tivo-border)',
                    paddingTop: 8,
                  }}
                >
                  Next ({formatTime(next.startTime)}): {next.title}
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* To Do List Preview */}
      {toDoQueue.length > 0 && (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>To Do List — Up Next</h2>
          <div className="card-grid">
            {toDoQueue.map((rec) => (
              <div
                key={rec.id}
                className="card"
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="pill pill-hd">CH {rec.channelNumber}</span>
                  <span className={rec.status === 'conflict' ? 'pill pill-ad' : 'tivo-rec-badge'}>
                    {rec.status === 'conflict' ? (
                      <>
                        <CircleDot size={11} /> CONFLICT
                      </>
                    ) : rec.seriesPassId ? (
                      'RR'
                    ) : (
                      'R'
                    )}
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{rec.title}</div>
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
