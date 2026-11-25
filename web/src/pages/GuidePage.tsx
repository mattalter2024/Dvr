import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, Star } from 'lucide-react';
import { api, formatTime, type Channel, type Program } from '../api/client';
import { ProgramModal } from '../components/ProgramModal';

interface GuidePageProps {
  onWatchLive: (channel: Channel) => void;
  onRecordEpisode: (program: Program) => Promise<void>;
  onCreateSeriesPass: (program: Program, newOnly: boolean) => Promise<void>;
  refreshSignal: number;
}

const SLOT_MINUTES = 30;
const PIXELS_PER_SLOT = 190;
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
  const [selected, setSelected] = useState<{ channel: Channel; program: Program } | null>(null);
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
            p.title.toLowerCase().includes(q) ||
            (p.category ?? '').toLowerCase().includes(q),
        )
      );
    });
  }, [grid, searchQuery, favoritesOnly]);

  const toggleFavorite = async (channel: Channel) => {
    await api.updateChannel(channel.id, { favorite: !channel.favorite });
    await loadGuide();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Live TV Guide</h1>
          <p className="page-subtitle">
            Select any show to Watch Live, Record Episode, or create a Series Pass
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={16}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 12, pointerEvents: 'none' }}
            />
            <input
              type="text"
              placeholder="Search shows or channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 36, width: 230 }}
            />
          </div>

          <button
            className={`btn ${favoritesOnly ? 'btn-amber' : 'btn-secondary'}`}
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <Star size={15} /> Favorites
          </button>

          <button className="btn btn-secondary" onClick={() => setOffsetHours((h) => h - 3)}>
            <ChevronLeft size={16} /> -3h
          </button>
          <button className="btn btn-secondary" onClick={() => setOffsetHours(0)}>
            Now
          </button>
          <button className="btn btn-secondary" onClick={() => setOffsetHours((h) => h + 3)}>
            +3h <ChevronRight size={16} />
          </button>
          <button className="btn btn-secondary" onClick={() => void loadGuide()}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      <div className="epg-wrapper">
        <div className="epg-scroll">
          <div style={{ width: 190 + totalWidth, position: 'relative' }}>
            {/* Time Header */}
            <div className="epg-header-row">
              <div className="epg-channel-col" style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)' }}>
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

            {/* Channel Rows */}
            {filteredRows.map(({ channel, programs }) => (
              <div key={channel.id} className="epg-row">
                <div className="epg-channel-col">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <button
                      style={{ textAlign: 'left', flex: 1 }}
                      onClick={() => onWatchLive(channel)}
                      title="Watch channel live"
                    >
                      <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--accent)' }}>
                        {channel.guideNumber}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
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
                        color={channel.favorite ? '#f59e0b' : '#475569'}
                        fill={channel.favorite ? '#f59e0b' : 'none'}
                      />
                    </button>
                  </div>
                </div>

                <div className="epg-track" style={{ width: totalWidth }}>
                  {showNowLine && <div className="epg-now-line" style={{ left: nowLineLeft }} />}

                  {programs.map((prog) => {
                    const pStart = Math.max(startMs, Date.parse(prog.startTime));
                    const pEnd = Math.min(startMs + TOTAL_HOURS * 3600 * 1000, Date.parse(prog.endTime));
                    if (pEnd <= pStart) return null;
                    const left = (pStart - startMs) * pxPerMs + 3;
                    const width = Math.max(46, (pEnd - pStart) * pxPerMs - 6);
                    const airingNow = Date.parse(prog.startTime) <= nowMs && Date.parse(prog.endTime) > nowMs;
                    const recInfo = grid?.recordingByProgramId[prog.id];

                    return (
                      <button
                        key={prog.id}
                        className={`epg-cell ${airingNow ? 'airing-now' : ''} ${recInfo ? 'has-rec' : ''}`}
                        style={{ left, width }}
                        onClick={() => setSelected({ channel, program: prog })}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            width: '100%',
                          }}
                        >
                          {recInfo && <span style={{ color: '#ef4444', marginRight: 5 }}>●</span>}
                          {prog.title}
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
                          {prog.isNew && <span style={{ color: '#7dd3fc', fontWeight: 700 }}>NEW</span>}
                          {prog.isLive && <span style={{ color: '#f87171', fontWeight: 700 }}>LIVE</span>}
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

      {selected && (
        <ProgramModal
          channel={selected.channel}
          program={selected.program}
          existingRecordingStatus={grid?.recordingByProgramId[selected.program.id]?.status}
          onClose={() => setSelected(null)}
          onWatchLive={onWatchLive}
          onRecordEpisode={(p) => void onRecordEpisode(p)}
          onCreateSeriesPass={(p, newOnly) => void onCreateSeriesPass(p, newOnly)}
        />
      )}
    </>
  );
}
