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
  Scissors,
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
              'Interactive DVR Preview (install FFmpeg or run Docker to record real .mp4 video)',
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

  // Simulated clock ticker when no FFmpeg binary is present so commercial skip can still be demoed live
  useEffect(() => {
    if (!simulatedMode || !isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 0.5;
        if (target.kind === 'recording' && duration > 0 && next >= duration) {
          return 0;
        }
        return next;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [simulatedMode, isPlaying, target.kind, duration]);

  // Active commercial segment at current playback position
  const activeCommercial = useMemo(() => {
    if (target.kind !== 'recording') return null;
    return (
      commercials.find((seg) => currentTime >= seg.startSec && currentTime < seg.endSec - 0.5) ??
      null
    );
  }, [commercials, currentTime, target.kind]);

  const seekTo = (sec: number) => {
    const clamped = Math.max(0, duration > 0 ? Math.min(duration, sec) : sec);
    if (!simulatedMode && videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
    setCurrentTime(clamped);
  };

  // Automatic Commercial Skipping engine!
  useEffect(() => {
    if (target.kind !== 'recording' || !autoSkip || !activeCommercial) return;
    if (lastSkipSegmentIdRef.current === activeCommercial.id) return;

    const returnToSec = currentTime;
    const skippedSeconds = Math.max(1, Math.round(activeCommercial.endSec - activeCommercial.startSec));
    lastSkipSegmentIdRef.current = activeCommercial.id;
    seekTo(activeCommercial.endSec);

    setSkipToast({
      segment: activeCommercial,
      returnToSec,
      skippedSeconds,
    });
    const t = window.setTimeout(() => setSkipToast(null), 6500);
    return () => window.clearTimeout(t);
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

  const stepChannel = (delta: number) => {
    if (target.kind !== 'live' || channels.length < 2) return;
    const idx = channels.findIndex((c) => c.id === target.channel.id);
    if (idx === -1) return;
    const next = channels[(idx + delta + channels.length) % channels.length];
    onSwitchChannel(next);
  };

  // Smart TV Remote / Keyboard controls inside fullscreen player
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      bumpHud();
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'MediaPlayPause') {
        if ((document.activeElement as HTMLElement)?.tagName !== 'BUTTON') {
          e.preventDefault();
          togglePlay();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'MediaFastForward') {
        e.preventDefault();
        seekTo(currentTime + 15);
      } else if (e.key === 'ArrowLeft' || e.key === 'MediaRewind') {
        e.preventDefault();
        if (skipToast) {
          // Pressing Left right after an auto-skip undoes the commercial skip!
          setAutoSkip(false);
          seekTo(skipToast.returnToSec);
          setSkipToast(null);
        } else {
          seekTo(currentTime - 10);
        }
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
  }, [currentTime, skipToast, target, channels]);

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

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
            background:
              activeCommercial
                ? 'radial-gradient(circle at center, #451a03 0%, #090d16 70%)'
                : 'radial-gradient(circle at center, #0c2648 0%, #060911 72%)',
            transition: 'background 0.4s',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 640, padding: 32 }}>
            <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center', gap: 10 }}>
              {target.kind === 'live' ? (
                <span className="pill pill-live">● LIVE OTA SIMULATOR</span>
              ) : activeCommercial ? (
                <span className="pill pill-ad">COMMERCIAL BREAK DETECTED</span>
              ) : (
                <span className="pill pill-new">DVR PLAYBACK PREVIEW</span>
              )}
            </div>
            <h2 style={{ fontSize: 34, fontWeight: 800, marginBottom: 10 }}>
              {target.kind === 'live'
                ? `${target.channel.guideNumber} ${target.channel.guideName}`
                : target.recording.title}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
              {statusMessage}
            </p>
            {target.kind === 'recording' && commercials.length > 0 && (
              <p style={{ color: '#fcd34d', fontSize: 14, marginTop: 14 }}>
                {commercials.length} commercial break(s) loaded on the amber timeline below. Scrub
                or play into an amber marker to see Auto-Skip in action!
              </p>
            )}
          </div>
        </div>
      )}

      {/* Auto-Skip Undo Toast */}
      {skipToast && (
        <div className="skip-toast">
          <Scissors size={20} color="#f59e0b" />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Skipped {formatDuration(skipToast.skippedSeconds)} commercial
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Press Left Arrow or click Undo to watch it
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

      {/* Top HUD */}
      {hudVisible && (
        <div className="player-hud-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button className="btn btn-secondary" onClick={onClose}>
              <ArrowLeft size={18} /> Back
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {target.kind === 'live' ? (
                  <>
                    <span className="pill pill-live">● LIVE</span>
                    <span style={{ fontWeight: 800, fontSize: 20 }}>
                      {target.channel.guideNumber} {target.channel.guideName}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pill pill-new">DVR</span>
                    <span style={{ fontWeight: 800, fontSize: 20 }}>{target.recording.title}</span>
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
                <button className="btn btn-danger" onClick={() => onRecordNow(target.channel)}>
                  <CircleDot size={16} /> Record
                </button>
              </>
            )}

            {target.kind === 'recording' && (
              <button
                className={`btn ${autoSkip ? 'btn-amber' : 'btn-secondary'}`}
                onClick={() => setAutoSkip((v) => !v)}
              >
                <Scissors size={16} /> Auto-Skip Ads: {autoSkip ? 'ON' : 'OFF'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom Transport + Commercial Marker Timeline */}
      {hudVisible && (
        <div className="player-hud-bottom">
          {target.kind === 'recording' && (
            <>
              <div
                className="timeline-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  lastSkipSegmentIdRef.current = null;
                  seekTo(ratio * duration);
                }}
                title="Click to seek — amber regions are detected commercial breaks"
              >
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

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}
              >
                <span>{formatDuration(currentTime)}</span>
                <span style={{ color: '#fcd34d' }}>
                  {commercials.length > 0
                    ? `${commercials.length} commercial break${commercials.length === 1 ? '' : 's'} marked in amber`
                    : 'No commercials detected'}
                </span>
                <span>{formatDuration(duration)}</span>
              </div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-primary" onClick={togglePlay}>
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>

              {target.kind === 'recording' && (
                <>
                  <button className="btn btn-secondary" onClick={() => seekTo(currentTime - 15)}>
                    <Rewind size={16} /> -15s
                  </button>
                  <button className="btn btn-secondary" onClick={() => seekTo(currentTime + 30)}>
                    <FastForward size={16} /> +30s
                  </button>
                  {activeCommercial && (
                    <button
                      className="btn btn-amber"
                      onClick={() => seekTo(activeCommercial.endSec)}
                    >
                      <SkipForward size={16} /> Skip Commercial
                    </button>
                  )}
                </>
              )}
            </div>

            <button
              className="btn btn-secondary"
              onClick={() => setIsMuted((m) => !m)}
              aria-label="Toggle Mute"
            >
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
