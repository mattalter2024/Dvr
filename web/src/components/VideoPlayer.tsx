import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleDot,
  FastForward,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  api,
  formatDuration,
  type Channel,
  type CommercialSegment,
  type LiveSession,
  type Recording,
} from '../api/client';
import {
  playTivoBackBoop,
  playTivoNavBloop,
  playTivoRecordTone,
  playTivoSkipChime,
} from '../utils/tivoSounds';

export type PlayerTarget =
  | { kind: 'live'; channel: Channel }
  | { kind: 'recording'; recording: Recording };

interface VideoPlayerProps {
  target: PlayerTarget;
  channels: Channel[];
  autoSkipDefault: boolean;
  onClose: () => void;
  onSwitchChannel: (channel: Channel) => void;
  onRecordNow: (channel: Channel) => void;
}

export function VideoPlayer({
  target,
  channels,
  autoSkipDefault,
  onClose,
  onSwitchChannel,
  onRecordNow,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastSkipSegmentIdRef = useRef<string | null>(null);

  const [session, setSession] = useState<LiveSession | null>(null);
  const [commercials, setCommercials] = useState<CommercialSegment[]>([]);
  const [autoSkip, setAutoSkip] = useState(autoSkipDefault);
  const [isPlaying, setIsPlaying] = useState(true);
  const [trickSpeed, setTrickSpeed] = useState<number>(1);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    target.kind === 'recording' ? Math.max(60, target.recording.durationSec || 120) : 0,
  );
  const [simulatedMode, setSimulatedMode] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Tuning OTA stream...');
  const [skipToast, setSkipToast] = useState<{
    segment: CommercialSegment;
    returnToSec: number;
    skippedSeconds: number;
  } | null>(null);
  const [hudVisible, setHudVisible] = useState(true);
  const hudTimerRef = useRef<number | null>(null);

  const bumpHud = () => {
    setHudVisible(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), 5000);
  };

  useEffect(() => {
    let cancelled = false;
    setStatusMessage(
      target.kind === 'live'
        ? `Tuning ${target.channel.guideNumber} ${target.channel.guideName}...`
        : `Loading ${target.recording.title}...`,
    );
    setSimulatedMode(false);
    setSkipToast(null);
    setTrickSpeed(1);
    lastSkipSegmentIdRef.current = null;

    if (target.kind === 'live') {
      setCommercials([]);
      api
        .startLive(target.channel.id)
        .then(({ session: liveSess }) => {
          if (cancelled) {
            void api.stopLive(liveSess.id);
            return;
          }
          setSession(liveSess);
          if (liveSess.mode === 'simulated') {
            setSimulatedMode(true);
            setStatusMessage('Simulated Live OTA Feed (install FFmpeg or run Docker for live HLS video)');
          } else {
            setStatusMessage('');
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setSimulatedMode(true);
            setStatusMessage(err instanceof Error ? err.message : 'Unable to tune channel');
          }
        });
    } else {
      setSession(null);
      api
        .getRecording(target.recording.id)
        .then(({ recording, commercials: segs }) => {
          if (cancelled) return;
          setCommercials(segs);
          setDuration(Math.max(60, recording.durationSec || 120));
          setCurrentTime(recording.watchedPositionSec || 0);
          if (!recording.filePath) {
            setSimulatedMode(true);
            setStatusMessage(
              'Interactive Preview (install FFmpeg or run Docker to record real .mp4 video)',
            );
          } else {
            setStatusMessage('');
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setStatusMessage(err instanceof Error ? err.message : 'Failed to load recording');
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    if (!session) return;
    const id = session.id;
    const interval = window.setInterval(() => {
      void api.heartbeatLive(id).catch(() => {});
    }, 12_000);
    return () => {
      window.clearInterval(interval);
      void api.stopLive(id).catch(() => {});
    };
  }, [session]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || simulatedMode) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (target.kind === 'live' && session && session.mode === 'hls-ffmpeg') {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true, // Offload MPEG-TS demuxing off main UI thread
          lowLatencyMode: true,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 6,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 90,
          fragLoadingMaxRetry: 6,
          manifestLoadingMaxRetry: 6,
        });
        hls.loadSource(session.playlistUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_ev, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setStatusMessage('Reconnecting live stream...');
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setStatusMessage('Stream error — please retry channel');
          }
        });
        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = session.playlistUrl;
        void video.play().catch(() => {});
      }
    } else if (target.kind === 'recording' && target.recording.filePath) {
      video.src = `/api/recordings/${encodeURIComponent(target.recording.id)}/stream`;
      const resumeAt = target.recording.watchedPositionSec || 0;
      const onLoaded = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          setDuration(video.duration);
        }
        if (resumeAt > 3 && resumeAt < (video.duration || Infinity) - 10) {
          video.currentTime = resumeAt;
        }
        void video.play().catch(() => {});
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      return () => video.removeEventListener('loadedmetadata', onLoaded);
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [target, session, simulatedMode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!simulatedMode && video) {
      video.playbackRate = trickSpeed >= 1 ? (trickSpeed === 1 ? 1 : trickSpeed === 2 ? 2 : 4) : 1;
    }

    if (trickSpeed < 0) {
      const stepPerTick = trickSpeed === -1 ? 1.5 : trickSpeed === -2 ? 4 : 8;
      const timer = window.setInterval(() => {
        setCurrentTime((prev) => {
          const next = Math.max(0, prev - stepPerTick);
          if (!simulatedMode && video) video.currentTime = next;
          return next;
        });
      }, 250);
      return () => window.clearInterval(timer);
    }

    if (simulatedMode && isPlaying) {
      const mult = trickSpeed === 1 ? 0.5 : trickSpeed === 2 ? 1.5 : 3.5;
      const timer = window.setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + mult;
          if (target.kind === 'recording' && duration > 0 && next >= duration) {
            return 0;
          }
          return next;
        });
      }, 500);
      return () => window.clearInterval(timer);
    }
  }, [simulatedMode, isPlaying, trickSpeed, target.kind, duration]);

  const activeCommercial = useMemo(() => {
    if (target.kind !== 'recording') return null;
    return (
      commercials.find((seg) => currentTime >= seg.startSec && currentTime < seg.endSec - 0.5) ??
      null
    );
  }, [commercials, currentTime, target.kind]);

  const nextOrActiveCommercial = useMemo(() => {
    if (activeCommercial) return activeCommercial;
    return commercials.find((seg) => seg.startSec > currentTime) ?? null;
  }, [activeCommercial, commercials, currentTime]);

  const seekTo = (sec: number) => {
    const clamped = Math.max(0, duration > 0 ? Math.min(duration, sec) : sec);
    if (!simulatedMode && videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
    setCurrentTime(clamped);
  };

  const triggerCommercialSkip = (seg: CommercialSegment) => {
    const returnToSec = currentTime;
    const skippedSeconds = Math.max(1, Math.round(seg.endSec - seg.startSec));
    lastSkipSegmentIdRef.current = seg.id;
    setTrickSpeed(1);
    seekTo(seg.endSec);
    playTivoSkipChime();
    setSkipToast({ segment: seg, returnToSec, skippedSeconds });
    window.setTimeout(() => {
      setSkipToast((prev) => (prev?.segment.id === seg.id ? null : prev));
    }, 6500);
  };

  useEffect(() => {
    if (target.kind !== 'recording' || !autoSkip || !activeCommercial) return;
    if (lastSkipSegmentIdRef.current === activeCommercial.id) return;
    triggerCommercialSkip(activeCommercial);
  }, [activeCommercial, autoSkip, target.kind]);

  useEffect(() => {
    if (target.kind !== 'recording') return;
    const recId = target.recording.id;
    const save = () => {
      if (currentTime > 2) {
        void api.saveProgress(recId, Math.floor(currentTime)).catch(() => {});
      }
    };
    const interval = window.setInterval(save, 5000);
    return () => {
      window.clearInterval(interval);
      save();
    };
  }, [target, currentTime]);

  const togglePlay = () => {
    bumpHud();
    setTrickSpeed(1);
    playTivoNavBloop();
    if (simulatedMode) {
      setIsPlaying((p) => !p);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const instantReplay8s = () => {
    bumpHud();
    setTrickSpeed(1);
    playTivoNavBloop();
    if (skipToast) {
      setAutoSkip(false);
      seekTo(skipToast.returnToSec);
      setSkipToast(null);
    } else {
      seekTo(currentTime - 8);
    }
  };

  const stepChannel = (delta: number) => {
    if (target.kind !== 'live' || channels.length < 2) return;
    const idx = channels.findIndex((c) => c.id === target.channel.id);
    if (idx === -1) return;
    playTivoNavBloop();
    const next = channels[(idx + delta + channels.length) % channels.length];
    onSwitchChannel(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      bumpHud();
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        playTivoBackBoop();
        onClose();
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'MediaPlayPause') {
        if ((document.activeElement as HTMLElement)?.tagName !== 'BUTTON') {
          e.preventDefault();
          togglePlay();
        }
      } else if (e.key.toLowerCase() === 'd' && target.kind === 'recording' && activeCommercial) {
        e.preventDefault();
        triggerCommercialSkip(activeCommercial);
      } else if (e.key === 'ArrowRight' || e.key === 'MediaFastForward') {
        e.preventDefault();
        seekTo(currentTime + 30);
      } else if (e.key === 'ArrowLeft' || e.key === 'MediaRewind') {
        e.preventDefault();
        instantReplay8s();
      } else if (e.key === 'ChannelUp' || (e.key === 'ArrowUp' && target.kind === 'live')) {
        e.preventDefault();
        stepChannel(-1);
      } else if (e.key === 'ChannelDown' || (e.key === 'ArrowDown' && target.kind === 'live')) {
        e.preventDefault();
        stepChannel(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentTime, skipToast, target, channels, activeCommercial]);

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const tickMarks = [20, 40, 60, 80];

  return (
    <div className="player-overlay" onMouseMove={bumpHud}>
      {!simulatedMode ? (
        <video
          ref={videoRef}
          className="player-video"
          muted={isMuted}
          playsInline
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => {
            if (Number.isFinite(e.currentTarget.duration)) {
              setDuration(e.currentTarget.duration);
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onClick={togglePlay}
        />
      ) : (
        <div
          onClick={togglePlay}
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            background: '#080c14',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 560, padding: 32 }}>
            <div style={{ marginBottom: 12 }}>
              {target.kind === 'live' ? (
                <span className="pill pill-live">Live Simulator</span>
              ) : activeCommercial ? (
                <span className="pill pill-ad">Commercial Break</span>
              ) : (
                <span className="pill pill-skip">Skip Ready</span>
              )}
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
              {target.kind === 'live'
                ? `${target.channel.guideNumber} ${target.channel.guideName}`
                : target.recording.title}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
              {statusMessage}
            </p>
            {target.kind === 'recording' && commercials.length > 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 12 }}>
                {commercials.length} commercial break(s) marked in amber on the timeline below.
              </p>
            )}
          </div>
        </div>
      )}

      {skipToast && (
        <div className="skip-toast">
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              Skipped {formatDuration(skipToast.skippedSeconds)} commercial
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Press Left Arrow (8s Replay) to undo
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setAutoSkip(false);
              seekTo(skipToast.returnToSec);
              setSkipToast(null);
            }}
          >
            <RotateCcw size={14} /> Undo
          </button>
        </div>
      )}

      {hudVisible && (
        <div className="player-hud-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-secondary"
              onClick={() => {
                playTivoBackBoop();
                onClose();
              }}
            >
              <ArrowLeft size={16} /> Back
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {target.kind === 'live' ? (
                  <>
                    <span className="pill pill-live">Live</span>
                    <span style={{ fontWeight: 600, fontSize: 18 }}>
                      {target.channel.guideNumber} {target.channel.guideName}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 600, fontSize: 18 }}>{target.recording.title}</span>
                    {target.recording.episodeNum && (
                      <span className="pill pill-hd">{target.recording.episodeNum}</span>
                    )}
                  </>
                )}
              </div>
              {target.kind === 'recording' && target.recording.subtitle && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {target.recording.subtitle}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {target.kind === 'live' && (
              <>
                <button className="btn btn-secondary" onClick={() => stepChannel(-1)}>
                  <ChevronUp size={15} /> Ch -
                </button>
                <button className="btn btn-secondary" onClick={() => stepChannel(1)}>
                  <ChevronDown size={15} /> Ch +
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    playTivoRecordTone();
                    onRecordNow(target.channel);
                  }}
                >
                  <CircleDot size={14} /> Record
                </button>
              </>
            )}

            {target.kind === 'recording' && (
              <button
                className={`btn ${autoSkip ? 'btn-skip' : 'btn-secondary'}`}
                onClick={() => {
                  playTivoNavBloop();
                  setAutoSkip((v) => !v);
                }}
              >
                Auto-Skip: {autoSkip ? 'On' : 'Off'}
              </button>
            )}
          </div>
        </div>
      )}

      {hudVisible && (
        <div className="tivo-trickplay-dock">
          {target.kind === 'recording' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 12, minWidth: 46, color: 'var(--text-secondary)' }}>
                {formatDuration(currentTime)}
              </span>

              <div
                className="timeline-track"
                style={{ flex: 1 }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  lastSkipSegmentIdRef.current = null;
                  setTrickSpeed(1);
                  seekTo(ratio * duration);
                }}
                title="Amber segments indicate commercial breaks"
              >
                {tickMarks.map((pct) => (
                  <div key={pct} className="timeline-tick" style={{ left: `${pct}%` }} />
                ))}
                {commercials.map((seg) => {
                  const leftPct = duration > 0 ? (seg.startSec / duration) * 100 : 0;
                  const widthPct =
                    duration > 0 ? Math.max(0.8, ((seg.endSec - seg.startSec) / duration) * 100) : 0;
                  return (
                    <div
                      key={seg.id}
                      className="timeline-ad-marker"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    />
                  );
                })}
                <div className="timeline-progress" style={{ width: `${progressPct}%` }} />
              </div>

              <span style={{ fontWeight: 500, fontSize: 12, minWidth: 46, textAlign: 'right', color: 'var(--text-muted)' }}>
                {formatDuration(duration)}
              </span>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {target.kind === 'recording' && (
                <>
                  <button className="btn btn-secondary" onClick={instantReplay8s} title="8-Second Instant Replay">
                    <RotateCcw size={14} /> 8s
                  </button>
                  <button
                    className={`btn ${trickSpeed < 0 ? 'btn-amber' : 'btn-secondary'}`}
                    onClick={() => {
                      playTivoNavBloop();
                      setTrickSpeed((s) => (s < 0 ? (s <= -3 ? -1 : s - 1) : -1));
                    }}
                  >
                    <Rewind size={14} /> {trickSpeed < 0 ? `${Math.abs(trickSpeed)}x` : ''}
                  </button>
                </>
              )}

              <button className="btn btn-primary" onClick={togglePlay}>
                {isPlaying && trickSpeed === 1 ? <Pause size={15} /> : <Play size={15} />}
                {isPlaying && trickSpeed === 1 ? 'Pause' : 'Play'}
              </button>

              {target.kind === 'recording' && (
                <>
                  <button
                    className={`btn ${trickSpeed > 1 ? 'btn-amber' : 'btn-secondary'}`}
                    onClick={() => {
                      playTivoNavBloop();
                      setTrickSpeed((s) => (s >= 3 ? 1 : s < 1 ? 2 : s + 1));
                    }}
                  >
                    <FastForward size={14} /> {trickSpeed > 1 ? `${trickSpeed}x` : ''}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      playTivoNavBloop();
                      setTrickSpeed(1);
                      seekTo(currentTime + 30);
                    }}
                  >
                    +30s
                  </button>

                  {activeCommercial ? (
                    <button
                      className="btn btn-skip"
                      onClick={() => triggerCommercialSkip(activeCommercial)}
                    >
                      <SkipForward size={14} /> Skip Ad (D)
                    </button>
                  ) : nextOrActiveCommercial ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
                      Next ad at {formatDuration(nextOrActiveCommercial.startSec)}
                    </span>
                  ) : null}
                </>
              )}
            </div>

            <button
              className="btn btn-secondary"
              onClick={() => setIsMuted((m) => !m)}
              aria-label="Toggle Mute"
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
