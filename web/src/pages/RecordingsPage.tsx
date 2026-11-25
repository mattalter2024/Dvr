import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  Folder,
  Play,
  Scissors,
  Square,
  Trash2,
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
      onNotify(`Commercial scan complete: ${res.commercials.length} ad break(s) tagged`);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 260 }}>
          <span className={`dot ${statusDot}`} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{rec.title}</span>
              {rec.episodeNum && <span className="pill pill-hd">{rec.episodeNum}</span>}
              {rec.commercialCount > 0 && (
                <span className="pill pill-skip">Skip ({rec.commercialCount})</span>
              )}
              {rec.status === 'recording' && <span className="pill pill-live">Recording</span>}
              {rec.watched && <Check size={14} color="var(--skip-green)" />}
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
              {rec.subtitle ? `${rec.subtitle} · ` : ''}
              Ch {rec.channelNumber} {rec.channelName} · {formatDuration(rec.durationSec)} ·{' '}
              {formatBytes(rec.fileSizeBytes)} ·{' '}
              {new Date(rec.scheduledStart).toLocaleDateString()}
            </div>

            {pct > 0 && (
              <div className="progress-bar-bg" style={{ maxWidth: 220, marginTop: 6 }}>
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(rec.status === 'completed' || rec.status === 'recording') && (
            <button
              className="btn btn-primary"
              onClick={() => {
                playTivoSelectChime();
                onPlay(rec);
              }}
            >
              <Play size={14} /> {rec.watchedPositionSec > 5 ? 'Resume' : 'Watch'}
            </button>
          )}
          {rec.status === 'recording' ? (
            <button
              className="btn btn-danger"
              onClick={async () => {
                await api.stopRecording(rec.id);
                onNotify(`Stopped "${rec.title}"`);
                onRefresh();
              }}
            >
              <Square size={13} /> Stop
            </button>
          ) : (
            <button
              className="btn btn-secondary"
              disabled={scanningId === rec.id}
              onClick={() => void handleScan(rec)}
            >
              <Scissors size={13} /> {scanningId === rec.id ? 'Scanning...' : 'Scan Ads'}
            </button>
          )}
          {rec.commercialCount > 0 && (
            <a
              className="btn btn-secondary"
              href={`/api/recordings/${encodeURIComponent(rec.id)}/commercials.edl`}
              download={`${rec.title}.edl`}
              style={{ textDecoration: 'none' }}
            >
              <Download size={13} /> EDL
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
            <Trash2 size={13} />
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
        </div>
        {openSeriesTitle && (
          <button
            className="btn btn-secondary"
            onClick={() => {
              playTivoBackBoop();
              setOpenSeriesTitle(null);
            }}
          >
            <ArrowLeft size={14} /> All Folders
          </button>
        )}
      </div>

      <div className="myshows-layout">
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
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.count}</span>
            </button>
          ))}
        </div>

        <div className="myshows-list">
          {activeEpisodes ? (
            <>
              <div
                style={{
                  padding: '12px 18px',
                  background: 'var(--bg-elevated)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Folder size={16} color="var(--accent)" />
                <span style={{ fontSize: 15, fontWeight: 600 }}>{openSeriesTitle}</span>
                <span className="pill pill-hd">{activeEpisodes.length}</span>
              </div>
              {activeEpisodes.map(renderEpisodeRow)}
            </>
          ) : groupedEntries.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 14 }}>
              No recordings in this folder yet.
            </div>
          ) : (
            groupedEntries.map(({ title, episodes }) => {
              if (episodes.length === 1) {
                return renderEpisodeRow(episodes[0]);
              }
              const skipReadyCount = episodes.filter((e) => e.commercialCount > 0).length;
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Folder size={18} color="var(--accent)" />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
                        <span className="pill pill-hd">{episodes.length}</span>
                        {skipReadyCount > 0 && <span className="pill pill-skip">Skip</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        Latest: {new Date(episodes[0].scheduledStart).toLocaleDateString()} · Ch{' '}
                        {episodes[0].channelNumber}
                      </div>
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Open →</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
