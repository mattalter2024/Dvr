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
import { api, formatTime, type Channel, type Program } from '../api/client';
import { ProgramModal } from '../components/ProgramModal';
import { playTivoNavBloop, playTivoRecordTone, playTivoSelectChime } from '../utils/tivoSounds';

interface GuidePageProps {
  onWatchLive: (channel: Channel) => void;
  onRecordEpisode: (program: Program) => Promise<void>;
  onCreateSeriesPass: (program: Program, newOnly: boolean) => Promise<void>;
  refreshSignal: number;
}

const SLOT_MINUTES = 30;
const PIXELS_PER_SLOT = 192;
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
  // Iconic TiVo Top Synopsis Banner follows hovered/focused cell in real time!
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
          <h1 className="page-title">Live TV Guide</h1>
          <p className="page-subtitle">
            Classic TiVo Program Grid · Highlight any show for synopsis, Record (R), or OnePass (RR)
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={15}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 12, pointerEvents: 'none' }}
            />
            <input
              type="text"
              placeholder="Search guide..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 34, width: 200 }}
            />
          </div>

          <button
            className={`btn ${favoritesOnly ? 'btn-amber' : 'btn-secondary'}`}
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <Star size={15} /> Favorites
          </button>

          <button
            className="btn btn-secondary"
            onClick={() => {
              playTivoNavBloop();
              setOffsetHours((h) => h - 3);
            }}
          >
            <ChevronLeft size={16} /> -3h
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
            +3h <ChevronRight size={16} />
          </button>
          <button className="btn btn-secondary" onClick={() => void loadGuide()}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Signature TiVo Top Program Synopsis Banner */}
      {focused && (
        <div className="tivo-guide-synopsis">
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 900, color: '#facc15', fontSize: 15 }}>
                {focused.channel.guideNumber} {focused.channel.guideName}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {formatTime(focused.program.startTime)} – {formatTime(focused.program.endTime)}
              </span>
              <span className="pill pill-hd">{focused.program.category}</span>
              {focused.program.episodeNum && (
                <span className="pill pill-hd">{focused.program.episodeNum}</span>
              )}
              {focused.program.isNew && <span className="pill pill-new">NEW</span>}
              {focused.program.isLive && <span className="pill pill-live">LIVE</span>}
              {focusedRec && <span className="tivo-rec-badge">R</span>}
            </div>
            <div style={{ fontSize: 21, fontWeight: 900, marginBottom: 4 }}>
              {focused.program.title}
              {focused.program.subtitle && (
                <span style={{ fontWeight: 600, fontSize: 15, color: '#93c5fd', marginLeft: 10 }}>
                  “{focused.program.subtitle}”
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                maxWidth: 820,
              }}
            >
              {focused.program.description || 'Over-the-air broadcast television program.'}
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
                <Play size={15} /> Watch Live
              </button>
            )}
            <button
              className="btn btn-danger"
              onClick={() => {
                playTivoRecordTone();
                void onRecordEpisode(focused.program);
              }}
            >
              <CircleDot size={15} /> {focusedRec ? 'Scheduled' : 'Record'}
            </button>
            <button
              className="btn btn-amber"
              onClick={() => {
                playTivoRecordTone();
                void onCreateSeriesPass(focused.program, true);
              }}
            >
              <Repeat size={15} /> OnePass
            </button>
          </div>
        </div>
      )}

      {/* Classic TiVo Deep-Blue EPG Grid */}
      <div className="epg-wrapper">
        <div className="epg-scroll">
          <div style={{ width: 196 + totalWidth, position: 'relative' }}>
            <div className="epg-header-row">
              <div
                className="epg-channel-col"
                style={{ fontWeight: 800, fontSize: 12, color: '#facc15', letterSpacing: '0.06em' }}
              >
                OTA CHANNELS
              </div>
              {timeSlots.map((slot) => (
                <div key={slot.ms} className="epg-time-slot" style={{ width: PIXELS_PER_SLOT }}>
                  {slot.label}
                </div>
              ))}
            </div>

            {loading && !grid && (
              <div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading TV guide...</div>
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
                      <div style={{ fontWeight: 900, fontSize: 17, color: '#facc15' }}>
                        {channel.guideNumber}
                      </div>
                      <div style={{ fontSize: 12, color: '#dbeafe', fontWeight: 700 }}>
                        {channel.guideName}
                      </div>
                    </button>
                    <button
                      onClick={() => void toggleFavorite(channel)}
                      aria-label="Toggle favorite"
                      style={{ padding: 6 }}
                    >
                      <Star
                        size={16}
                        color={channel.favorite ? '#facc15' : '#4b6b9e'}
                        fill={channel.favorite ? '#facc15' : 'none'}
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
                    const width = Math.max(48, (pEnd - pStart) * pxPerMs - 6);
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
                        style={{ left, width }}
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
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 14,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
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
                            color: 'var(--text-secondary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                          }}
                        >
                          <span>{prog.category}</span>
                          {prog.episodeNum && <span>· {prog.episodeNum}</span>}
                          {prog.isNew && (
                            <span style={{ color: '#7dd3fc', fontWeight: 800 }}>NEW</span>
                          )}
                          {prog.isLive && (
                            <span style={{ color: '#fca5a5', fontWeight: 800 }}>LIVE</span>
                          )}
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
