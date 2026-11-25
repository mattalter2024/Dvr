import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Play,
  Scissors,
  Square,
  Trash2,
} from 'lucide-react';
import { api, formatDuration, type Recording } from '../api/client';

interface RecordingsPageProps {
  recordings: Recording[];
  onPlay: (recording: Recording) => void;
  onRefresh: () => void;
  onNotify: (msg: string) => void;
}

export function RecordingsPage({
  recordings,
  onPlay,
  onRefresh,
  onNotify,
}: RecordingsPageProps) {
  const [filter, setFilter] = useState<'all' | 'unwatched' | 'active'>('all');
  const [scanningId, setScanningId] = useState<string | null>(null);

  const library = useMemo(() => {
    const relevant = recordings.filter(
      (r) => r.status === 'completed' || r.status === 'recording' || r.status === 'failed',
    );
    if (filter === 'unwatched') return relevant.filter((r) => !r.watched && r.status === 'completed');
    if (filter === 'active') return relevant.filter((r) => r.status === 'recording');
    return relevant;
  }, [recordings, filter]);

  const handleScan = async (rec: Recording) => {
    setScanningId(rec.id);
    try {
      const res = await api.scanCommercials(rec.id);
      onNotify(`Commercial scan complete: ${res.commercials.length} ad break(s) found`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Commercial scan failed');
    } finally {
      setScanningId(null);
    }
  };

  const handleStop = async (rec: Recording) => {
    await api.stopRecording(rec.id);
    onNotify(`Stopped recording "${rec.title}"`);
    onRefresh();
  };

  const handleDelete = async (rec: Recording) => {
    await api.deleteRecording(rec.id);
    onNotify(`Deleted "${rec.title}"`);
    onRefresh();
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes > 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">DVR Recordings</h1>
          <p className="page-subtitle">
            Watch ad-free recordings on any TV in the house with automatic commercial skipping
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['all', 'unwatched', 'active'] as const).map((tab) => (
            <button
              key={tab}
              className={`btn ${filter === tab ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(tab)}
            >
              {tab === 'all' ? 'All Library' : tab === 'unwatched' ? 'Unwatched' : 'Recording Now'}
            </button>
          ))}
        </div>
      </div>

      {library.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-secondary)' }}>
          No recordings match this view yet. Head to <strong>Home</strong> for a 1-minute test
          capture or schedule any program from the <strong>Live TV Guide</strong>.
        </div>
      ) : (
        <div className="card-grid">
          {library.map((rec) => {
            const pct =
              rec.durationSec > 0
                ? Math.min(100, (rec.watchedPositionSec / rec.durationSec) * 100)
                : 0;

            return (
              <div key={rec.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="pill pill-hd">
                    {rec.channelNumber} {rec.channelName}
                  </span>
                  {rec.status === 'recording' ? (
                    <span className="pill pill-live">● RECORDING</span>
                  ) : rec.status === 'failed' ? (
                    <span className="pill pill-live">FAILED</span>
                  ) : rec.commercialCount > 0 ? (
                    <span className="pill pill-ad">
                      <Scissors size={11} /> {rec.commercialCount} ads marked
                    </span>
                  ) : (
                    <span className="pill pill-ok">{rec.commercialScanStatus}</span>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {rec.title}
                    {rec.watched && <CheckCircle2 size={16} color="#10b981" />}
                  </div>
                  {rec.subtitle && (
                    <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 2 }}>
                      {rec.episodeNum ? `${rec.episodeNum} · ` : ''}
                      {rec.subtitle}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                    {formatDuration(rec.durationSec)} · {formatBytes(rec.fileSizeBytes)} ·{' '}
                    {new Date(rec.scheduledStart).toLocaleDateString()}
                  </div>
                  {rec.errorMessage && (
                    <div style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>
                      {rec.errorMessage}
                    </div>
                  )}
                </div>

                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                  {(rec.status === 'completed' || rec.status === 'recording') && (
                    <button className="btn btn-primary" onClick={() => onPlay(rec)}>
                      <Play size={15} /> {rec.watchedPositionSec > 5 ? 'Resume' : 'Watch'}
                    </button>
                  )}

                  {rec.status === 'recording' ? (
                    <button className="btn btn-danger" onClick={() => void handleStop(rec)}>
                      <Square size={14} /> Stop
                    </button>
                  ) : (
                    <button
                      className="btn btn-amber"
                      disabled={scanningId === rec.id}
                      onClick={() => void handleScan(rec)}
                    >
                      <Scissors size={14} />{' '}
                      {scanningId === rec.id ? 'Scanning...' : 'Scan Ads'}
                    </button>
                  )}

                  {rec.commercialCount > 0 && (
                    <a
                      className="btn btn-secondary"
                      href={`/api/recordings/${encodeURIComponent(rec.id)}/commercials.edl`}
                      download={`${rec.title}.edl`}
                      style={{ textDecoration: 'none' }}
                      title="Download Comskip EDL file"
                    >
                      <Download size={14} /> EDL
                    </a>
                  )}

                  <button
                    className="btn btn-secondary"
                    onClick={() => void handleDelete(rec)}
                    aria-label="Delete recording"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
