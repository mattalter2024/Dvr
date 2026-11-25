import { useEffect, useMemo, useState } from 'react';
import { CircleDot, ExternalLink, Play, Tv } from 'lucide-react';
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
import { playTivoNavBloop, playTivoRecordTone, playTivoSelectChime } from '../utils/tivoSounds';

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
  // DIRECTV "Your TV" channel carousel sorted by real watch frequency, recency, and favorites
  const frequentChannels = useMemo(() => {
    return nowPlaying.slice().sort((a, b) => {
      const countDiff = (b.channel.watchCount ?? 0) - (a.channel.watchCount ?? 0);
      if (countDiff !== 0) return countDiff;
      const lastA = a.channel.lastWatchedAt ? Date.parse(a.channel.lastWatchedAt) : 0;
      const lastB = b.channel.lastWatchedAt ? Date.parse(b.channel.lastWatchedAt) : 0;
      if (lastB !== lastA) return lastB - lastA;
      if (a.channel.favorite !== b.channel.favorite) return a.channel.favorite ? -1 : 1;
      return Number.parseFloat(a.channel.guideNumber) - Number.parseFloat(b.channel.guideNumber);
    });
  }, [nowPlaying]);

  const [previewChannelId, setPreviewChannelId] = useState<string | null>(null);

  useEffect(() => {
    if (!previewChannelId && frequentChannels[0]) {
      setPreviewChannelId(frequentChannels[0].channel.id);
    }
  }, [frequentChannels, previewChannelId]);

  const heroItem = useMemo(() => {
    return (
      frequentChannels.find((item) => item.channel.id === previewChannelId) ??
      frequentChannels[0] ??
      null
    );
  }, [frequentChannels, previewChannelId]);

  // Compute live airing progress percentage for the hero show
  const heroProgressPct = useMemo(() => {
    if (!heroItem?.current) return 0;
    const start = Date.parse(heroItem.current.startTime);
    const end = Date.parse(heroItem.current.endTime);
    if (end <= start) return 0;
    return Math.max(2, Math.min(100, ((Date.now() - start) / (end - start)) * 100));
  }, [heroItem]);

  // Latest recordings: active captures first, followed by newest completed recordings
  const latestRecordings = useMemo(() => {
    const active = recordings.filter((r) => r.status === 'recording');
    const completed = recordings
      .filter((r) => r.status === 'completed')
      .sort(
        (a, b) =>
          Date.parse(b.actualStart ?? b.scheduledStart) -
          Date.parse(a.actualStart ?? a.scheduledStart),
      );
    return [...active, ...completed].slice(0, 12);
  }, [recordings]);

  const pinnedApps = apps.filter((a) => a.pinned);
  const toDoQueue = recordings
    .filter((r) => r.status === 'scheduled' || r.status === 'conflict')
    .slice(0, 8);

  return (
    <>
      {/* DIRECTV Stream-style "Your TV" Hero Stage + Interactive Frequent Channels Carousel */}
      {heroItem && (
        <section className="dtv-hero" aria-label="Your TV Live Preview">
          <img
            src={getProgramScreenshotUrl(heroItem.current, heroItem.channel)}
            alt={heroItem.current?.title ?? heroItem.channel.guideName}
            className="dtv-hero-bg"
          />
          <div className="dtv-hero-scrim" />

          <div className="dtv-hero-content">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                {heroItem.channel.guideNumber} {heroItem.channel.guideName}
              </span>
              {heroItem.current?.isLive && <span className="pill pill-live">Live</span>}
              {heroItem.current?.category && (
                <span className="pill pill-hd">{heroItem.current.category}</span>
              )}
              {heroItem.current?.episodeNum && (
                <span className="pill pill-hd">{heroItem.current.episodeNum}</span>
              )}
              {heroItem.current && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {formatTime(heroItem.current.startTime)} – {formatTime(heroItem.current.endTime)}
                </span>
              )}
            </div>

            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {heroItem.current?.title ?? `${heroItem.channel.guideName} Live`}
            </h1>

            {heroItem.current?.description && (
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  maxWidth: 560,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {heroItem.current.description}
              </p>
            )}

            {heroItem.current && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 340 }}>
                <div className="progress-bar-bg" style={{ flex: 1 }}>
                  <div className="progress-bar-fill" style={{ width: `${heroProgressPct}%` }} />
                </div>
                {heroItem.next && (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 165,
                    }}
                  >
                    Next: {heroItem.next.title}
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  playTivoSelectChime();
                  onWatchLive(heroItem.channel);
                }}
              >
                <Play size={14} /> Watch Live
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  playTivoRecordTone();
                  onQuickTestRecord(heroItem.channel);
                }}
              >
                <CircleDot size={14} color="var(--rec-red)" /> Record (1m Test)
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  playTivoSelectChime();
                  onOpenGuide();
                }}
              >
                <Tv size={14} /> Full Guide
              </button>
            </div>
          </div>

          {/* Frequent & Recent Channels Horizontal Strip (hover/focus updates Hero Preview above) */}
          <div className="dtv-hero-carousel">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Frequent Channels
                {health && !health.capabilities.ffmpegAvailable ? ' · Simulation mode' : ''}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Highlight to preview · Select to watch
              </span>
            </div>

            <div className="dtv-row-scroll">
              {frequentChannels.map(({ channel, current }) => {
                const isSelected = heroItem.channel.id === channel.id;
                return (
                  <button
                    key={channel.id}
                    className={`dtv-channel-tile ${isSelected ? 'active' : ''}`}
                    onMouseEnter={() => setPreviewChannelId(channel.id)}
                    onFocus={() => {
                      playTivoNavBloop();
                      setPreviewChannelId(channel.id);
                    }}
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
                          style={{ background: 'rgba(7, 11, 20, 0.8)', color: '#e2e8f0' }}
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
                            style={{ background: 'rgba(7, 11, 20, 0.78)', color: '#93c5fd' }}
                          >
                            {channel.watchCount}×
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ padding: '9px 11px 10px' }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {current?.title ?? 'Live Broadcast'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {current ? `${formatTime(current.startTime)} – ${formatTime(current.endTime)}` : channel.network}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Row 2: Latest Recordings (Horizontal Row directly below Hero) */}
      <section>
        <h2 className="section-heading">Latest Recordings</h2>
        {latestRecordings.length === 0 ? (
          <div className="card" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            No recordings yet. Click <strong>Record (1m Test)</strong> above or schedule any show in
            the Guide.
          </div>
        ) : (
          <div className="dtv-row-scroll">
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
                  className="channel-card dtv-rec-tile"
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
                          style={{ background: 'rgba(7, 11, 20, 0.8)', color: '#e2e8f0' }}
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
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {rec.title}
                    </div>
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

      {/* Row 3: Streaming Apps */}
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
          <div className="dtv-row-scroll">
            {pinnedApps.map((app) => (
              <button
                key={app.id}
                className="channel-card dtv-app-tile"
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
                    width: 42,
                    height: 42,
                    borderRadius: 9,
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
                <ExternalLink size={13} color="var(--text-muted)" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Row 4: Up Next on To Do List */}
      {toDoQueue.length > 0 && (
        <section>
          <h2 className="section-heading">Up Next on To Do List</h2>
          <div className="dtv-row-scroll">
            {toDoQueue.map((rec) => (
              <div
                key={rec.id}
                className="card"
                style={{
                  flex: '0 0 280px',
                  scrollSnapAlign: 'start',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                }}
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
