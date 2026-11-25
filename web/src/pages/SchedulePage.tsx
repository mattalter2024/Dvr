import { useState } from 'react';
import { AlertTriangle, CalendarClock, Plus, Repeat, Trash2, XCircle } from 'lucide-react';
import { api, formatTime, type Recording, type SeriesPass } from '../api/client';
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
    });
    setNewTitle('');
    onNotify(`OnePass™ created for "${res.seriesPass.title}" (${res.scheduledCount} queued)`);
    onRefresh();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">To Do List & OnePass™ Manager</h1>
          <p className="page-subtitle">
            Upcoming recording queue, tuner conflict monitor, and automatic OnePass™ series rules
          </p>
        </div>
      </div>

      {/* TiVo To Do List */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarClock size={18} color="#facc15" /> To Do List ({upcoming.length})
        </h2>

        {upcoming.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Your To Do List is clear. Pick any show in the Live TV Guide or create a OnePass™ below.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {upcoming.map((rec) => (
              <div
                key={rec.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  padding: '13px 18px',
                  borderRadius: 14,
                  background: 'var(--tivo-bg-card)',
                  border:
                    rec.status === 'conflict'
                      ? '1px solid rgba(250, 204, 21, 0.75)'
                      : '1px solid var(--tivo-border)',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className="tivo-rec-badge">{rec.seriesPassId ? 'RR' : 'R'}</span>
                    <span className="pill pill-hd">
                      {rec.channelNumber} {rec.channelName}
                    </span>
                    {rec.status === 'conflict' ? (
                      <span className="pill pill-ad">
                        <AlertTriangle size={11} /> TUNER CONFLICT
                      </span>
                    ) : rec.status === 'recording' ? (
                      <span className="pill pill-live">● RECORDING</span>
                    ) : (
                      <span className="pill pill-new">SCHEDULED</span>
                    )}
                    {rec.episodeNum && <span className="pill pill-hd">{rec.episodeNum}</span>}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{rec.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {new Date(rec.scheduledStart).toLocaleDateString()} ·{' '}
                    {formatTime(rec.scheduledStart)} – {formatTime(rec.scheduledEnd)} (padding -
                    {rec.paddingStartMin}m / +{rec.paddingEndMin}m)
                  </div>
                  {rec.errorMessage && (
                    <div style={{ fontSize: 12, color: '#fde047', marginTop: 4 }}>
                      {rec.errorMessage}
                    </div>
                  )}
                </div>

                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await api.stopRecording(rec.id);
                    onNotify(`Cancelled "${rec.title}"`);
                    onRefresh();
                  }}
                >
                  <XCircle size={15} /> {rec.status === 'recording' ? 'Stop' : 'Cancel'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* TiVo OnePass Manager */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Repeat size={18} color="#22c55e" /> OnePass™ Manager ({seriesPasses.length})
        </h2>

        <form
          onSubmit={(e) => void createPass(e)}
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Show Title</label>
            <input
              type="text"
              placeholder="e.g. Harbor Watch"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <div className="field" style={{ width: 155 }}>
            <label>Episodes</label>
            <select
              value={newOnly ? 'new' : 'all'}
              onChange={(e) => setNewOnly(e.target.value === 'new')}
            >
              <option value="new">New Only</option>
              <option value="all">New & Reruns</option>
            </select>
          </div>
          <div className="field" style={{ width: 150 }}>
            <label>Keep At Most</label>
            <select value={keepLimit} onChange={(e) => setKeepLimit(Number(e.target.value))}>
              <option value={0}>Keep All</option>
              <option value={3}>3 Episodes</option>
              <option value={5}>5 Episodes</option>
              <option value={10}>10 Episodes</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: 42 }}>
            <Plus size={16} /> Create OnePass™
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {seriesPasses.map((pass) => (
            <div
              key={pass.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '13px 18px',
                borderRadius: 14,
                background: 'var(--tivo-bg-card)',
                border: '1px solid var(--tivo-border)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="tivo-rec-badge">RR</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{pass.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {pass.newOnly ? 'New episodes only' : 'New & reruns'} ·{' '}
                    {pass.keepLimit > 0 ? `Keep latest ${pass.keepLimit}` : 'Keep all'} · Padding -
                    {pass.paddingStartMin}m / +{pass.paddingEndMin}m
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`btn ${pass.newOnly ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={async () => {
                    await api.updateSeriesPass(pass.id, { newOnly: !pass.newOnly });
                    onRefresh();
                  }}
                >
                  {pass.newOnly ? 'New Only' : 'All Episodes'}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await api.deleteSeriesPass(pass.id);
                    onNotify(`Removed OnePass™ for "${pass.title}"`);
                    onRefresh();
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
