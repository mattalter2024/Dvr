import { useState } from 'react';
import { AlertTriangle, Plus, Trash2, XCircle } from 'lucide-react';
import {
  api,
  formatRetention,
  formatTime,
  getRecordingScreenshotUrl,
  getTitleScreenshotUrl,
  RETENTION_OPTIONS,
  type Recording,
  type SeriesPass,
} from '../api/client';
import { playTivoRecordTone } from '../utils/tivoSounds';

interface SchedulePageProps {
  recordings: Recording[];
  seriesPasses: SeriesPass[];
  onRefresh: () => void;
  onNotify: (msg: string) => void;
}

export function SchedulePage({
  recordings,
  seriesPasses,
  onRefresh,
  onNotify,
}: SchedulePageProps) {
  const [newTitle, setNewTitle] = useState('');
  const [newOnly, setNewOnly] = useState(true);
  const [keepLimit, setKeepLimit] = useState(5);
  const [keepDays, setKeepDays] = useState(30);

  const upcoming = recordings
    .filter((r) => r.status === 'scheduled' || r.status === 'conflict' || r.status === 'recording')
    .sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart));

  const createPass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    playTivoRecordTone();
    const res = await api.createSeriesPass({
      title: newTitle.trim(),
      newOnly,
      keepLimit,
      keepDays,
    });
    setNewTitle('');
    onNotify(`OnePass created for "${res.seriesPass.title}" (${res.scheduledCount} queued)`);
    onRefresh();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">To Do & OnePass</h1>
        </div>
      </div>

      {/* To Do List */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 className="section-heading" style={{ marginBottom: 0 }}>
          To Do List ({upcoming.length})
        </h2>

        {upcoming.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            No upcoming recordings scheduled.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map((rec) => (
              <div
                key={rec.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  padding: '12px 15px',
                  borderRadius: 10,
                  background: 'var(--bg-elevated)',
                  border:
                    rec.status === 'conflict'
                      ? '1px solid rgba(217, 119, 6, 0.5)'
                      : '1px solid var(--border-subtle)',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="show-thumb-inline" style={{ width: 96, height: 54 }}>
                    <img
                      src={getRecordingScreenshotUrl(rec)}
                      alt={rec.title}
                      className="show-shot-img"
                      loading="lazy"
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span className="tivo-rec-badge">{rec.seriesPassId ? 'RR' : 'R'}</span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{rec.title}</span>
                      {rec.episodeNum && <span className="pill pill-hd">{rec.episodeNum}</span>}
                      {rec.status === 'conflict' && (
                        <span className="pill pill-ad">
                          <AlertTriangle size={11} /> Conflict
                        </span>
                      )}
                      {rec.status === 'recording' && <span className="pill pill-live">Recording</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Ch {rec.channelNumber} {rec.channelName} ·{' '}
                      {new Date(rec.scheduledStart).toLocaleDateString()} ·{' '}
                      {formatTime(rec.scheduledStart)} – {formatTime(rec.scheduledEnd)} ·{' '}
                      {formatRetention(rec.keepDays, rec.keepProtected)}
                    </div>
                    {rec.errorMessage && (
                      <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 3 }}>
                        {rec.errorMessage}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await api.stopRecording(rec.id);
                    onNotify(`Cancelled "${rec.title}"`);
                    onRefresh();
                  }}
                >
                  <XCircle size={14} /> {rec.status === 'recording' ? 'Stop' : 'Cancel'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* OnePass Manager */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 className="section-heading" style={{ marginBottom: 0 }}>
          OnePass Manager ({seriesPasses.length})
        </h2>

        <form
          onSubmit={(e) => void createPass(e)}
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <div className="field" style={{ flex: 1, minWidth: 210 }}>
            <label>Show Title</label>
            <input
              type="text"
              placeholder="e.g. Harbor Watch"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <div className="field" style={{ width: 145 }}>
            <label>Episodes</label>
            <select
              value={newOnly ? 'new' : 'all'}
              onChange={(e) => setNewOnly(e.target.value === 'new')}
            >
              <option value="new">New Only</option>
              <option value="all">New & Reruns</option>
            </select>
          </div>
          <div className="field" style={{ width: 135 }}>
            <label>Keep At Most</label>
            <select value={keepLimit} onChange={(e) => setKeepLimit(Number(e.target.value))}>
              <option value={0}>Keep All</option>
              <option value={3}>3 Episodes</option>
              <option value={5}>5 Episodes</option>
              <option value={10}>10 Episodes</option>
            </select>
          </div>
          <div className="field" style={{ width: 135 }}>
            <label>Save For</label>
            <select value={keepDays} onChange={(e) => setKeepDays(Number(e.target.value))}>
              {RETENTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: 39 }}>
            <Plus size={14} /> Add OnePass
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {seriesPasses.map((pass) => (
            <div
              key={pass.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '11px 15px',
                borderRadius: 10,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="show-thumb-inline" style={{ width: 96, height: 54 }}>
                  <img
                    src={getTitleScreenshotUrl(pass.title, 'Drama', 'OnePass')}
                    alt={pass.title}
                    className="show-shot-img"
                    loading="lazy"
                  />
                </div>
                <span className="tivo-rec-badge">RR</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{pass.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {pass.newOnly ? 'New only' : 'New & reruns'} ·{' '}
                    {pass.keepLimit > 0 ? `Keep latest ${pass.keepLimit}` : 'Keep all'} ·{' '}
                    {formatRetention(pass.keepDays)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    await api.updateSeriesPass(pass.id, { newOnly: !pass.newOnly });
                    onRefresh();
                  }}
                >
                  {pass.newOnly ? 'New Only' : 'All'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    await api.deleteSeriesPass(pass.id);
                    onNotify(`Removed OnePass for "${pass.title}"`);
                    onRefresh();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
