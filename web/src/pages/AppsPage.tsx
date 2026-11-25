import { useState } from 'react';
import { ExternalLink, Pin, PinOff, Plus, Trash2, X } from 'lucide-react';
import { api, type StreamingApp } from '../api/client';
import { playTivoSelectChime } from '../utils/tivoSounds';

interface AppsPageProps {
  apps: StreamingApp[];
  onAppsChanged: (apps: StreamingApp[]) => void;
  onNotify: (msg: string) => void;
}

export function AppsPage({ apps, onAppsChanged, onNotify }: AppsPageProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [webUrl, setWebUrl] = useState('');
  const [tagline, setTagline] = useState('');
  const [category, setCategory] = useState('Subscription');
  const [androidPackage, setAndroidPackage] = useState('');
  const [brandColor, setBrandColor] = useState('#334155');
  const [submitting, setSubmitting] = useState(false);

  const launchApp = (app: StreamingApp) => {
    playTivoSelectChime();
    window.open(app.webUrl, '_blank', 'noopener,noreferrer');
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !webUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.addApp({
        name: name.trim(),
        webUrl: webUrl.trim(),
        tagline: tagline.trim() || 'Streaming service',
        category,
        androidPackage: androidPackage.trim(),
        brandColor,
        pinned: true,
      });
      onAppsChanged(res.apps);
      setName('');
      setWebUrl('');
      setTagline('');
      setAndroidPackage('');
      setShowAddForm(false);
      onNotify(`Added ${res.app.name} to Streaming Apps`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to add app');
    } finally {
      setSubmitting(false);
    }
  };

  const togglePin = async (app: StreamingApp) => {
    const res = await api.updateApp(app.id, { pinned: !app.pinned });
    onAppsChanged(res.apps);
    onNotify(res.app.pinned ? `Pinned ${app.name} to Home` : `Unpinned ${app.name} from Home`);
  };

  const removeApp = async (app: StreamingApp) => {
    await api.deleteApp(app.id);
    onAppsChanged(apps.filter((a) => a.id !== app.id));
    onNotify(`Removed ${app.name}`);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Streaming Apps</h1>
          <p className="page-subtitle">
            Launch your streaming services alongside Live TV & DVR recordings
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setShowAddForm((v) => !v)}
        >
          {showAddForm ? <X size={14} /> : <Plus size={14} />}
          {showAddForm ? 'Close' : 'Add App'}
        </button>
      </div>

      {showAddForm && (
        <form
          className="card"
          onSubmit={(e) => void handleAdd(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div className="form-grid">
            <div className="field">
              <label>App Name</label>
              <input
                required
                placeholder="e.g. Disney+, Hulu, YouTube"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Web URL</label>
              <input
                required
                placeholder="https://www.disneyplus.com"
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Short Description</label>
              <input
                placeholder="Movies, originals & more"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="Subscription">Subscription</option>
                <option value="Free TV">Free TV</option>
                <option value="Live TV">Live TV</option>
                <option value="Sports">Sports</option>
              </select>
            </div>
            <div className="field">
              <label>Android TV Package (optional)</label>
              <input
                placeholder="e.g. com.disney.disneyplus"
                value={androidPackage}
                onChange={(e) => setAndroidPackage(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Accent Color</label>
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                style={{ height: 39, padding: 4 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <Plus size={14} /> Save App
            </button>
          </div>
        </form>
      )}

      <div className="card-grid">
        {apps.map((app) => (
          <div key={app.id} className="channel-card">
            <button
              onClick={() => launchApp(app)}
              style={{ width: '100%', textAlign: 'left', display: 'block' }}
            >
              <div
                className="show-shot-wrap"
                style={{
                  background: `linear-gradient(145deg, ${app.brandColor}42 0%, #0c1220 75%)`,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: app.monogram.length > 3 ? 26 : 36,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    color: '#f1f5f9',
                  }}
                >
                  {app.monogram}
                </span>
                <div className="show-shot-overlay">
                  <span
                    className="pill"
                    style={{ background: 'rgba(7, 11, 20, 0.72)', color: '#cbd5e1' }}
                  >
                    {app.category}
                  </span>
                  {app.pinned && (
                    <span
                      className="pill"
                      style={{ background: 'rgba(7, 11, 20, 0.72)', color: '#93c5fd' }}
                    >
                      Pinned
                    </span>
                  )}
                </div>
              </div>
            </button>

            <div className="channel-card-body" style={{ gap: 10 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{app.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {app.tagline}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => launchApp(app)}>
                  <ExternalLink size={13} /> Open
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => void togglePin(app)}
                  title={app.pinned ? 'Unpin from Home' : 'Pin to Home'}
                >
                  {app.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => void removeApp(app)}
                  aria-label={`Remove ${app.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
