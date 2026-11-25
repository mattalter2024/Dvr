import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Play,
  RefreshCw,
  Repeat,
  Search,
  Star,
} from 'lucide-react';
import {
  api,
  formatTime,
  getProgramScreenshotUrl,
  type Channel,
  type Program,
} from '../api/client';
import { ProgramModal } from '../components/ProgramModal';
import { playTivoNavBloop, playTivoRecordTone, playTivoSelectChime } from '../utils/tivoSounds';

interface GuidePageProps {
  onWatchLive: (channel: Channel) => void;
  onRecordEpisode: (program: Program) => Promise<void>;
  onCreateSeriesPass: (program: Program, newOnly: boolean) => Promise<void>;
  refreshSignal: number;
}

const SLOT_MINUTES = 30;
const PIXELS_PER_SLOT = 186;
const TOTAL_HOURS = 6;

export function GuidePage({
  onWatchLive,
  onRecordEpisode,
  onCreateSeriesPass,
  refreshSignal,
}: GuidePageProps) {
  const [offsetHours, setOffsetHours] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [grid, setGrid] = useState<{
    start: string;
    end: string;
    rows: Array<{ channel: Channel; programs: Program[] }>;
    recordingByProgramId: Record<string, { id: string; status: string }>;
  } | null>(null);
  const [focused, setFocused] = useState<{ channel: Channel; program: Program } | null>(null);
  const [modalSelection, setModalSelection] = useState<{
    channel: Channel;
    program: Program;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const windowStartIso = useMemo(() => {
    const now = Date.now();
    const floored = Math.floor(now / (30 * 60 * 1000)) * (30 * 60 * 1000);
    return new Date(floored + offsetHours * 3600 * 1000).toISOString();
  }, [offsetHours]);

  const loadGuide = async () => {
    setLoading(true);
    try {
      const data = await api.getGuide(windowStartIso, TOTAL_HOURS);
      setGrid(data);
      if (!focused && data.rows[0]?.programs[0]) {
        setFocused({ channel: data.rows[0].channel, program: data.rows[0].programs[0] });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGuide();
  }, [windowStartIso, refreshSignal]);

  const startMs = grid ? Date.parse(grid.start) : Date.parse(windowStartIso);
  const totalSlots = (TOTAL_HOURS * 60) / SLOT_MINUTES;
  const totalWidth = totalSlots * PIXELS_PER_SLOT;
  const pxPerMs = PIXELS_PER_SLOT / (SLOT_MINUTES * 60 * 1000);

  const timeSlots = Array.from({ length: totalSlots }, (_, i) => {
    const ms = startMs + i * SLOT_MINUTES * 60 * 1000;
    return { ms, label: formatTime(new Date(ms).toISOString()) };
  });

  const nowMs = Date.now();
  const nowLineLeft = (nowMs - startMs) * pxPerMs;
  const showNowLine = nowLineLeft >= 0 && nowLineLeft <= totalWidth;

  const filteredRows = useMemo(() => {
    if (!grid) return [];
    const q = searchQuery.trim().toLowerCase();
    return grid.rows.filter(({ channel, programs }) => {
      if (favoritesOnly && !channel.favorite) return false;
      if (!q) return true;
      return (
        channel.guideNumber.toLowerCase().includes(q) ||
        channel.guideName.toLowerCase().includes(q) ||
        channel.network.toLowerCase().includes(q) ||
        programs.some(
          (p) =>
            p.title.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q),
        )
      );
    });
  }, [grid, searchQuery, favoritesOnly]);

  const toggleFavorite = async (channel: Channel) => {
    await api.updateChannel(channel.id, { favorite: !channel.favorite });
    await loadGuide();
  };

  const focusedRec = focused ? grid?.recordingByProgramId[focused.program.id] : undefined;
  const focusedIsNow = focused
    ? Date.parse(focused.program.startTime) <= nowMs && Date.parse(focused.program.endTime) > nowMs
    : false;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Guide</h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={14}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 11, pointerEvents: 'none' }}
            />
            <input
              type="text"
              placeholder="Search guide..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 32, width: 190 }}
            />
          </div>

          <button
            className={`btn ${favoritesOnly ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <Star size={14} /> Favorites
          </button>

          <button
            className="btn btn-secondary"
            onClick={() => {
              playTivoNavBloop();
              setOffsetHours((h) => h - 3);
            }}
          >
            <ChevronLeft size={15} /> -3h
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              playTivoNavBloop();
              setOffsetHours(0);
            }}
          >
            Now
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              playTivoNavBloop();
              setOffsetHours((h) => h + 3);
            }}
          >
            +3h <ChevronRight size={15} />
          </button>
          <button className="btn btn-secondary" onClick={() => void loadGuide()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Top Program Synopsis Bar with 16:9 Show Screenshot */}
      {focused && (
        <div className="tivo-guide-synopsis">
          <div className="show-thumb-inline" style={{ width: 176, height: 99 }}>
            <img
              src={getProgramScreenshotUrl(focused.program, focused.channel)}
              alt={focused.program.title}
              className="show-shot-img"
            />
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 13 }}>
                {focused.channel.guideNumber} {focused.channel.guideName}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {formatTime(focused.program.startTime)} – {formatTime(focused.program.endTime)}
              </span>
              <span className="pill pill-hd">{focused.program.category}</span>
              {focused.program.episodeNum && (
                <span className="pill pill-hd">{focused.program.episodeNum}</span>
              )}
              {focused.program.isNew && <span className="pill pill-new">New</span>}
              {focused.program.isLive && <span className="pill pill-live">Live</span>}
              {focusedRec && <span className="tivo-rec-badge">R</span>}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 3 }}>
              {focused.program.title}
              {focused.program.subtitle && (
                <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--text-secondary)', marginLeft: 8 }}>
                  — {focused.program.subtitle}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                maxWidth: 780,
              }}
            >
              {focused.program.description || 'Over-the-air broadcast program.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {focusedIsNow && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  playTivoSelectChime();
                  onWatchLive(focused.channel);
                }}
              >
                <Play size={14} /> Watch
              </button>
            )}
            <button
              className="btn btn-danger"
              onClick={() => {
                playTivoRecordTone();
                void onRecordEpisode(focused.program);
              }}
            >
              <CircleDot size={14} /> {focusedRec ? 'Scheduled' : 'Record'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                playTivoRecordTone();
                void onCreateSeriesPass(focused.program, true);
              }}
            >
              <Repeat size={14} /> OnePass
            </button>
          </div>
        </div>
      )}

      {/* EPG Grid */}
      <div className="epg-wrapper">
        <div className="epg-scroll">
          <div style={{ width: 184 + totalWidth, position: 'relative' }}>
            <div className="epg-header-row">
              <div
                className="epg-channel-col"
                style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)' }}
              >
                Channels
              </div>
              {timeSlots.map((slot) => (
                <div key={slot.ms} className="epg-time-slot" style={{ width: PIXELS_PER_SLOT }}>
                  {slot.label}
                </div>
              ))}
            </div>

            {loading && !grid && (
              <div style={{ padding: 28, color: 'var(--text-secondary)', fontSize: 14 }}>
                Loading guide...
              </div>
            )}

            {filteredRows.map(({ channel, programs }) => (
              <div key={channel.id} className="epg-row">
                <div className="epg-channel-col">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <button
                      style={{ textAlign: 'left', flex: 1 }}
                      onClick={() => {
                        playTivoSelectChime();
                        onWatchLive(channel);
                      }}
                      title="Watch channel live"
                    >
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>
                        {channel.guideNumber}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {channel.guideName}
                      </div>
                    </button>
                    <button
                      onClick={() => void toggleFavorite(channel)}
                      aria-label="Toggle favorite"
                      style={{ padding: 5 }}
                    >
                      <Star
                        size={14}
                        color={channel.favorite ? '#93c5fd' : '#475569'}
                        fill={channel.favorite ? '#93c5fd' : 'none'}
                      />
                    </button>
                  </div>
                </div>

                <div className="epg-track" style={{ width: totalWidth }}>
                  {showNowLine && <div className="epg-now-line" style={{ left: nowLineLeft }} />}

                  {programs.map((prog) => {
                    const pStart = Math.max(startMs, Date.parse(prog.startTime));
                    const pEnd = Math.min(
                      startMs + TOTAL_HOURS * 3600 * 1000,
                      Date.parse(prog.endTime),
                    );
                    if (pEnd <= pStart) return null;
                    const left = (pStart - startMs) * pxPerMs + 3;
                    const width = Math.max(46, (pEnd - pStart) * pxPerMs - 6);
                    const airingNow =
                      Date.parse(prog.startTime) <= nowMs && Date.parse(prog.endTime) > nowMs;
                    const recInfo = grid?.recordingByProgramId[prog.id];
                    const isHighlighted = focused?.program.id === prog.id;

                    return (
                      <button
                        key={prog.id}
                        className={`epg-cell ${airingNow ? 'airing-now' : ''} ${
                          recInfo ? 'has-rec' : ''
                        } ${isHighlighted ? 'highlighted' : ''}`}
                        style={{
                          left,
                          width,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'flex-start',
                          gap: 9,
                        }}
                        onMouseEnter={() => setFocused({ channel, program: prog })}
                        onFocus={() => {
                          playTivoNavBloop();
                          setFocused({ channel, program: prog });
                        }}
                        onClick={() => {
                          playTivoSelectChime();
                          setModalSelection({ channel, program: prog });
                        }}
                      >
                        {width >= 150 && (
                          <div className="show-thumb-inline" style={{ width: 64, height: 36 }}>
                            <img
                              src={getProgramScreenshotUrl(prog, channel)}
                              alt=""
                              className="show-shot-img"
                              loading="lazy"
                            />
                          </div>
                        )}
                        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: 13,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            {recInfo && <span className="tivo-rec-badge">R</span>}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {prog.title}
                            </span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 11,
                              color: 'var(--text-muted)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                            }}
                          >
                            <span>{prog.category}</span>
                            {prog.episodeNum && <span>· {prog.episodeNum}</span>}
                            {prog.isNew && <span style={{ color: '#93c5fd' }}>New</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modalSelection && (
        <ProgramModal
          channel={modalSelection.channel}
          program={modalSelection.program}
          existingRecordingStatus={grid?.recordingByProgramId[modalSelection.program.id]?.status}
          onClose={() => setModalSelection(null)}
          onWatchLive={onWatchLive}
          onRecordEpisode={(p) => void onRecordEpisode(p)}
          onCreateSeriesPass={(p, newOnly) => void onCreateSeriesPass(p, newOnly)}
        />
      )}
    </>
  );
}
