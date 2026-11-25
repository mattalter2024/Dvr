import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Folder,
  Play,
  Scissors,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { api, formatDuration, type Recording } from '../api/client';
import { playTivoBackBoop, playTivoNavBloop, playTivoSelectChime } from '../utils/tivoSounds';

interface RecordingsPageProps {
  recordings: Recording[];
  onPlay: (recording: Recording) => void;
  onRefresh: () => void;
  onNotify: (msg: string) => void;
}

type TivoFolder = 'all' | 'series' | 'movies' | 'sports_news' | 'unwatched' | 'recording';

export function RecordingsPage({
  recordings,
  onPlay,
  onRefresh,
  onNotify,
}: RecordingsPageProps) {
  const [activeFolder, setActiveFolder] = useState<TivoFolder>('all');
  const [openSeriesTitle, setOpenSeriesTitle] = useState<string | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);

  const library = useMemo(
    () =>
      recordings.filter(
        (r) => r.status === 'completed' || r.status === 'recording' || r.status === 'failed',
      ),
    [recordings],
  );

  const folderFiltered = useMemo(() => {
    switch (activeFolder) {
      case 'unwatched':
        return library.filter((r) => !r.watched && r.status === 'completed');
      case 'recording':
        return library.filter((r) => r.status === 'recording');
      case 'movies':
        return library.filter((r) => r.category.toLowerCase().includes('movie'));
      case 'sports_news':
        return library.filter((r) =>
          ['sport', 'news'].some((k) => r.category.toLowerCase().includes(k)),
        );
      case 'series':
        return library.filter((r) => !r.category.toLowerCase().includes('movie'));
      default:
        return library;
    }
  }, [library, activeFolder]);

  // TiVo-style Show Folders: group multiple episodes of the same title into one collapsible folder!
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, Recording[]>();
    for (const rec of folderFiltered) {
      const list = groups.get(rec.title) ?? [];
      list.push(rec);
      groups.set(rec.title, list);
    }
    return Array.from(groups.entries()).map(([title, episodes]) => ({
      title,
      episodes: episodes.sort((a, b) => Date.parse(b.scheduledStart) - Date.parse(a.scheduledStart)),
    }));
  }, [folderFiltered]);

  const activeEpisodes = useMemo(() => {
    if (!openSeriesTitle) return null;
    return groupedEntries.find((g) => g.title === openSeriesTitle)?.episodes ?? null;
  }, [groupedEntries, openSeriesTitle]);

  const folders: Array<{ id: TivoFolder; label: string; count: number }> = [
    { id: 'all', label: 'All Shows', count: library.length },
    {
      id: 'unwatched',
      label: 'Unwatched',
      count: library.filter((r) => !r.watched && r.status === 'completed').length,
    },
    {
      id: 'series',
      label: 'TV Series',
      count: library.filter((r) => !r.category.toLowerCase().includes('movie')).length,
    },
    {
      id: 'movies',
      label: 'Movies',
      count: library.filter((r) => r.category.toLowerCase().includes('movie')).length,
    },
    {
      id: 'sports_news',
      label: 'Sports & News',
      count: library.filter((r) =>
        ['sport', 'news'].some((k) => r.category.toLowerCase().includes(k)),
      ).length,
    },
    {
      id: 'recording',
      label: 'Recording Now',
      count: library.filter((r) => r.status === 'recording').length,
    },
  ];

  const handleScan = async (rec: Recording) => {
    setScanningId(rec.id);
    try {
      const res = await api.scanCommercials(rec.id);
      onNotify(`SkipMode™ ready: ${res.commercials.length} commercial break(s) tagged`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Commercial scan failed');
    } finally {
      setScanningId(null);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes > 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  };

  const renderEpisodeRow = (rec: Recording) => {
    const pct =
      rec.durationSec > 0 ? Math.min(100, (rec.watchedPositionSec / rec.durationSec) * 100) : 0;
    const statusDot =
      rec.status === 'recording'
        ? 'rec'
        : rec.watchedPositionSec > 5 && !rec.watched
          ? 'partial'
          : 'live';

    return (
      <div key={rec.id} className="myshows-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 260 }}>
          <span
            className={`dot ${statusDot}`}
            style={{ width: 12, height: 12 }}
            title={
              rec.status === 'recording'
                ? 'Currently Recording'
                : rec.watched
                  ? 'Watched'
                  : 'Ready to Watch'
            }
          />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 17 }}>{rec.title}</strong>
              {rec.episodeNum && <span className="pill pill-hd">{rec.episodeNum}</span>}
              {rec.commercialCount > 0 && (
                <span className="pill pill-skip">
                  <Zap size={10} /> SKIP · {rec.commercialCount} ads
                </span>
              )}
              {rec.status === 'recording' && <span className="pill pill-live">● REC</span>}
              {rec.watched && <CheckCircle2 size={15} color="#22c55e" />}
            </div>

            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
              {rec.subtitle ? `${rec.subtitle} · ` : ''}
              CH {rec.channelNumber} {rec.channelName} · {formatDuration(rec.durationSec)} ·{' '}
              {formatBytes(rec.fileSizeBytes)} ·{' '}
              {new Date(rec.scheduledStart).toLocaleDateString()}
            </div>

            {pct > 0 && (
              <div className="progress-bar-bg" style={{ maxWidth: 260, marginTop: 7 }}>
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(rec.status === 'completed' || rec.status === 'recording') && (
            <button
              className="btn btn-primary"
              onClick={() => {
                playTivoSelectChime();
                onPlay(rec);
              }}
            >
              <Play size={15} /> {rec.watchedPositionSec > 5 ? 'Resume' : 'Watch'}
            </button>
          )}
          {rec.status === 'recording' ? (
            <button
              className="btn btn-danger"
              onClick={async () => {
                await api.stopRecording(rec.id);
                onNotify(`Stopped recording "${rec.title}"`);
                onRefresh();
              }}
            >
              <Square size={14} /> Stop
            </button>
          ) : (
            <button
              className="btn btn-amber"
              disabled={scanningId === rec.id}
              onClick={() => void handleScan(rec)}
            >
              <Scissors size={14} /> {scanningId === rec.id ? 'Scanning...' : 'Scan Ads'}
            </button>
          )}
          {rec.commercialCount > 0 && (
            <a
              className="btn btn-secondary"
              href={`/api/recordings/${encodeURIComponent(rec.id)}/commercials.edl`}
              download={`${rec.title}.edl`}
              style={{ textDecoration: 'none' }}
            >
              <Download size={14} /> EDL
            </a>
          )}
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await api.deleteRecording(rec.id);
              onNotify(`Deleted "${rec.title}"`);
              onRefresh();
            }}
            aria-label="Delete recording"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Shows</h1>
          <p className="page-subtitle">
            TiVo-style categorized DVR library · Green SKIP badge means instant commercial skipping is ready
          </p>
        </div>
        {openSeriesTitle && (
          <button
            className="btn btn-secondary"
            onClick={() => {
              playTivoBackBoop();
              setOpenSeriesTitle(null);
            }}
          >
            <ArrowLeft size={16} /> Back to All Folders
          </button>
        )}
      </div>

      <div className="myshows-layout">
        {/* Left TiVo Category Folders */}
        <div className="myshows-folders">
          {folders.map((f) => (
            <button
              key={f.id}
              className={`myshows-folder-btn ${activeFolder === f.id ? 'active' : ''}`}
              onClick={() => {
                playTivoNavBloop();
                setActiveFolder(f.id);
                setOpenSeriesTitle(null);
              }}
            >
              <span>{f.label}</span>
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(4, 15, 40, 0.55)',
                  color: activeFolder === f.id ? '#facc15' : 'var(--text-secondary)',
                }}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {/* Right TiVo My Shows List */}
        <div className="myshows-list">
          {activeEpisodes ? (
            <>
              <div
                style={{
                  padding: '14px 20px',
                  background: 'rgba(29, 78, 216, 0.28)',
                  borderBottom: '1px solid var(--tivo-border-strong)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Folder size={18} color="#facc15" />
                <strong style={{ fontSize: 17 }}>{openSeriesTitle}</strong>
                <span className="pill pill-hd">{activeEpisodes.length} episodes</span>
              </div>
              {activeEpisodes.map(renderEpisodeRow)}
            </>
          ) : groupedEntries.length === 0 ? (
            <div style={{ padding: 28, color: 'var(--text-secondary)', fontSize: 15 }}>
              No recordings in this folder yet. Head to <strong>TiVo Central</strong> for a 1-minute
              SkipMode test capture or schedule any show from the <strong>Live TV Guide</strong>.
            </div>
          ) : (
            groupedEntries.map(({ title, episodes }) => {
              if (episodes.length === 1) {
                return renderEpisodeRow(episodes[0]);
              }
              const skipReadyCount = episodes.filter((e) => e.commercialCount > 0).length;
              const unwatchedCount = episodes.filter((e) => !e.watched).length;
              return (
                <button
                  key={title}
                  className="myshows-row"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => {
                    playTivoSelectChime();
                    setOpenSeriesTitle(title);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Folder size={22} color="#facc15" />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: 18 }}>{title}</strong>
                        <span className="pill pill-hd">({episodes.length})</span>
                        {unwatchedCount > 0 && (
                          <span className="pill pill-ok">{unwatchedCount} new</span>
                        )}
                        {skipReadyCount > 0 && (
                          <span className="pill pill-skip">
                            <Zap size={10} /> SKIP
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Latest: {new Date(episodes[0].scheduledStart).toLocaleDateString()} · CH{' '}
                        {episodes[0].channelNumber} {episodes[0].channelName}
                      </div>
                    </div>
                  </div>
                  <span style={{ color: '#facc15', fontWeight: 800, fontSize: 14 }}>
                    Open Folder →
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
