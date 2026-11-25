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
  Zap,
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
  const [trickSpeed, setTrickSpeed] = useState<number>(1); // TiVo 3-speed TrickPlay (-3..3, 1 = normal)
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
    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), 5500);
  };

  // Start Live TV HLS session OR load Recording + Commercial Segments
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
              'TiVo SkipMode™ Interactive Preview (install FFmpeg or run Docker to record real .mp4 video)',
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

  // Live session heartbeat + cleanup on close/switch
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

  // Attach HLS.js for Live TV OR MP4 HTTP Range stream for DVR Recordings
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
          lowLatencyMode: true,
          liveSyncDurationCount: 2,
          backBufferLength: 120,
        });
        hls.loadSource(session.playlistUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_ev, data) => {
          if (data.fatal) {
            setStatusMessage('Stream interrupted — retrying...');
            hls.startLoad();
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

  // TrickPlay playback speed sync (TiVo 1x / 2x / 3x fast-forward & rewind stepping)
  useEffect(() => {
    const video = videoRef.current;
    if (!simulatedMode && video) {
      if (trickSpeed >= 1) {
        video.playbackRate = trickSpeed === 1 ? 1 : trickSpeed === 2 ? 2 : 4;
      } else {
        video.playbackRate = 1;
      }
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

  // Active commercial segment at current playback position
  const activeCommercial = useMemo(() => {
    if (target.kind !== 'recording') return null;
    return (
      commercials.find((seg) => currentTime >= seg.startSec && currentTime < seg.endSec - 0.5) ??
      null
    );
  }, [commercials, currentTime, target.kind]);

  // Next upcoming commercial break (for manual SkipMode button)
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

  // Automatic TiVo SkipMode commercial jumping!
  useEffect(() => {
    if (target.kind !== 'recording' || !autoSkip || !activeCommercial) return;
    if (lastSkipSegmentIdRef.current === activeCommercial.id) return;
    triggerCommercialSkip(activeCommercial);
  }, [activeCommercial, autoSkip, target.kind]);

  // Whole-house playback resume progress sync every 5 seconds
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
      seekTo(currentTime - 8); // Iconic TiVo 8-second Instant Replay!
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

  // TiVo Remote / Smart TV Keyboard controls inside fullscreen player
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
        // Iconic TiVo green 'D' button for instant SkipMode jump!
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
            background: activeCommercial
              ? 'radial-gradient(circle at center, #78350f 0%, #061330 70%)'
              : 'radial-gradient(circle at center, #143b8c 0%, #040e26 72%)',
            transition: 'background 0.4s',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 660, padding: 32 }}>
            <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center', gap: 10 }}>
              {target.kind === 'live' ? (
                <span className="pill pill-live">● LIVE OTA SIMULATOR</span>
              ) : activeCommercial ? (
                <span className="pill pill-ad">COMMERCIAL BREAK — PRESS D OR SKIP</span>
              ) : (
                <span className="pill pill-skip">
                  <Zap size={12} /> SKIPMODE™ READY
                </span>
              )}
            </div>
            <h2 style={{ fontSize: 36, fontWeight: 900, marginBottom: 10 }}>
              {target.kind === 'live'
                ? `${target.channel.guideNumber} ${target.channel.guideName}`
                : target.recording.title}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
              {statusMessage}
            </p>
            {target.kind === 'recording' && commercials.length > 0 && (
              <p style={{ color: '#fde047', fontSize: 14, marginTop: 14, fontWeight: 600 }}>
                {commercials.length} commercial break(s) marked in gold on the TiVo TrickPlay bar
                below. Play or scrub into a gold marker to test SkipMode™!
              </p>
            )}
          </div>
        </div>
      )}

      {/* Iconic TiVo SkipMode™ Toast */}
      {skipToast && (
        <div className="skip-toast">
          <span className="pill pill-skip" style={{ fontSize: 13, padding: '6px 12px' }}>
            <Zap size={14} /> SKIP
          </span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              SkipMode™ jumped {formatDuration(skipToast.skippedSeconds)} of commercials
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Press Instant Replay (←) or click Undo to watch them
            </div>
          </div>
          <button
            className="btn btn-amber"
            onClick={() => {
              setAutoSkip(false);
              seekTo(skipToast.returnToSec);
              setSkipToast(null);
            }}
          >
            <RotateCcw size={15} /> Undo
          </button>
        </div>
      )}

      {/* Top Broadcast Info Banner */}
      {hudVisible && (
        <div className="player-hud-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              className="btn btn-secondary"
              onClick={() => {
                playTivoBackBoop();
                onClose();
              }}
            >
              <ArrowLeft size={18} /> Back
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {target.kind === 'live' ? (
                  <>
                    <span className="pill pill-live">● LIVE TV</span>
                    <span style={{ fontWeight: 900, fontSize: 22 }}>
                      {target.channel.guideNumber} {target.channel.guideName}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pill pill-skip">
                      <Zap size={11} /> SKIPMODE
                    </span>
                    <span style={{ fontWeight: 900, fontSize: 22 }}>{target.recording.title}</span>
                    {target.recording.episodeNum && (
                      <span className="pill pill-hd">{target.recording.episodeNum}</span>
                    )}
                  </>
                )}
              </div>
              {target.kind === 'recording' && target.recording.subtitle && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {target.recording.subtitle}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {target.kind === 'live' && (
              <>
                <button className="btn btn-secondary" onClick={() => stepChannel(-1)}>
                  <ChevronUp size={17} /> Ch -
                </button>
                <button className="btn btn-secondary" onClick={() => stepChannel(1)}>
                  <ChevronDown size={17} /> Ch +
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    playTivoRecordTone();
                    onRecordNow(target.channel);
                  }}
                >
                  <CircleDot size={16} /> Record
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
                <Zap size={16} /> Auto-SkipMode: {autoSkip ? 'ON' : 'OFF'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Iconic TiVo Rounded TrickPlay Status Bar */}
      {hudVisible && (
        <div className="tivo-trickplay-dock">
          {target.kind === 'recording' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontWeight: 900, fontSize: 14, minWidth: 52, color: '#86efac' }}>
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
                  title="TiVo TrickPlay Bar — Gold blocks are detected commercial breaks"
                >
                  {tickMarks.map((pct) => (
                    <div key={pct} className="timeline-tick" style={{ left: `${pct}%` }} />
                  ))}
                  {commercials.map((seg) => {
                    const leftPct = duration > 0 ? (seg.startSec / duration) * 100 : 0;
                    const widthPct =
                      duration > 0 ? Math.max(1, ((seg.endSec - seg.startSec) / duration) * 100) : 0;
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

                <span style={{ fontWeight: 800, fontSize: 14, minWidth: 52, textAlign: 'right' }}>
                  {formatDuration(duration)}
                </span>
              </div>
            </>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {target.kind === 'recording' && (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={instantReplay8s}
                    title="TiVo 8-Second Instant Replay"
                  >
                    <RotateCcw size={16} /> 8s Replay
                  </button>
                  <button
                    className={`btn ${trickSpeed < 0 ? 'btn-amber' : 'btn-secondary'}`}
                    onClick={() => {
                      playTivoNavBloop();
                      setTrickSpeed((s) => (s < 0 ? (s <= -3 ? -1 : s - 1) : -1));
                    }}
                  >
                    <Rewind size={16} /> {trickSpeed < 0 ? `${Math.abs(trickSpeed)}x` : 'Rew'}
                  </button>
                </>
              )}

              <button className="btn btn-primary" onClick={togglePlay}>
                {isPlaying && trickSpeed === 1 ? <Pause size={18} /> : <Play size={18} />}
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
                    <FastForward size={16} /> {trickSpeed > 1 ? `${trickSpeed}x` : 'FF'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      playTivoNavBloop();
                      setTrickSpeed(1);
                      seekTo(currentTime + 30);
                    }}
                  >
                    +30s Advance
                  </button>

                  {activeCommercial ? (
                    <button
                      className="btn btn-skip"
                      onClick={() => triggerCommercialSkip(activeCommercial)}
                    >
                      <SkipForward size={16} /> SKIP COMMERCIAL (D)
                    </button>
                  ) : nextOrActiveCommercial ? (
                    <span style={{ fontSize: 12, color: '#86efac', fontWeight: 700, marginLeft: 4 }}>
                      ● Next ad break at {formatDuration(nextOrActiveCommercial.startSec)}
                    </span>
                  ) : null}
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {trickSpeed !== 1 && (
                <span className="pill pill-ad">
                  TrickPlay {trickSpeed > 0 ? `>>> ${trickSpeed}x` : `<<< ${Math.abs(trickSpeed)}x`}
                </span>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => setIsMuted((m) => !m)}
                aria-label="Toggle Mute"
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
