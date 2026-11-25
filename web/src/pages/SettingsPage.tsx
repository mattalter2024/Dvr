import { useEffect, useState } from 'react';
import {
  Antenna,
  CheckCircle2,
  Download,
  HardDrive,
  Radio,
  RefreshCw,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  Tv2,
} from 'lucide-react';
import {
  api,
  formatBytes,
  RETENTION_OPTIONS,
  type CleanupReport,
  type CleanupStatus,
  type DvrSettings,
  type SystemCapabilities,
  type TunerUtilization,
} from '../api/client';

interface SettingsPageProps {
  tuners: TunerUtilization[];
  onRefresh: () => void;
  onNotify: (msg: string) => void;
}

export function SettingsPage({ tuners, onRefresh, onNotify }: SettingsPageProps) {
  const [settings, setSettings] = useState<DvrSettings | null>(null);
  const [caps, setCaps] = useState<SystemCapabilities | null>(null);
  const [cleanupStatus, setCleanupStatus] = useState<CleanupStatus | null>(null);
  const [lastCleanupResult, setLastCleanupResult] = useState<CleanupReport | null>(null);
  const [hdhrHost, setHdhrHost] = useState('');
  const [xmltvInput, setXmltvInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadSettings = async () => {
    const [res, cs] = await Promise.all([api.getSettings(), api.getCleanupStatus()]);
    setSettings(res.settings);
    setCaps(res.capabilities);
    setCleanupStatus(cs);
    setXmltvInput(res.settings.xmltvUrl || '');
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleDiscoverHdhr = async () => {
    setBusy('discover');
    try {
      const res = await api.discoverHdhr();
      if (res.discovered.length > 0) {
        onNotify(`Discovered ${res.discovered.length} HDHomeRun tuner(s) on your home network`);
      } else {
        onNotify('No HDHomeRun devices responded. You can enter its IP manually.');
      }
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setBusy(null);
    }
  };

  const handleAddHdhr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hdhrHost.trim()) return;
    setBusy('add-hdhr');
    try {
      const res = await api.addHdhr(hdhrHost.trim());
      setHdhrHost('');
      onNotify(`Added ${res.tuner.name} with ${res.channelCount} OTA channels`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to reach HDHomeRun');
    } finally {
      setBusy(null);
    }
  };

  const handleImportXmltv = async () => {
    if (!xmltvInput.trim()) return;
    setBusy('xmltv');
    try {
      const res = await api.importXmltv(xmltvInput.trim());
      onNotify(
        `Imported ${res.programCount} programs across ${res.matchedChannelCount} matched channels`,
      );
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'XMLTV import failed');
    } finally {
      setBusy(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setBusy('save');
    try {
      const res = await api.updateSettings(settings);
      setSettings(res.settings);
      setCaps(res.capabilities);
      const cs = await api.getCleanupStatus();
      setCleanupStatus(cs);
      onNotify('DVR settings saved');
      onRefresh();
    } finally {
      setBusy(null);
    }
  };

  const handleCleanup = async (dryRun: boolean) => {
    setBusy(dryRun ? 'cleanup-preview' : 'cleanup-run');
    try {
      const { report, status } = await api.runCleanup(dryRun);
      setCleanupStatus(status);
      setLastCleanupResult(report);
      const removedTotal =
        report.expiredDeleted +
        report.watchedDeleted +
        report.quotaDeleted +
        report.orphansRemoved;
      onNotify(
        dryRun
          ? `Cleanup preview: ${removedTotal} item(s) eligible (${formatBytes(report.bytesFreed)})`
          : `Cleanup complete: removed ${removedTotal} item(s), freed ${formatBytes(report.bytesFreed)}`,
      );
      if (!dryRun) onRefresh();
    } finally {
      setBusy(null);
    }
  };

  if (!settings || !caps) {
    return <div className="card">Loading DVR settings...</div>;
  }

  const usedGb = cleanupStatus ? cleanupStatus.totalRecordingsBytes / 1_073_741_824 : 0;
  const quotaPct =
    settings.maxStorageGb > 0 ? Math.min(100, (usedGb / settings.maxStorageGb) * 100) : 0;
  const eligibleCount = cleanupStatus
    ? cleanupStatus.preview.expiredDeleted +
      cleanupStatus.preview.watchedDeleted +
      cleanupStatus.preview.quotaDeleted +
      cleanupStatus.preview.orphansRemoved
    : 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Tuners, EPG guide feeds, recording retention, cleanup, and commercial skipping
          </p>
        </div>
      </div>

      {/* Whole-House Smart TV Connection Card */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="section-heading" style={{ marginBottom: 0 }}>
          <Tv2 size={15} color="var(--accent)" /> Whole-House TV Access
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Android TV, Google TV & Fire TV apps auto-discover this server on UDP port{' '}
          <code>{caps.discoveryUdpPort}</code>, or connect directly via:
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {caps.lanAddresses.map((ip) => (
            <div
              key={ip}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                fontFamily: 'monospace',
                fontSize: 13,
                color: 'var(--accent)',
              }}
            >
              http://{ip}:{caps.port}
            </div>
          ))}
        </div>
      </section>

      {/* Storage Retention & Automated Cleanup Section */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <h2 className="section-heading" style={{ marginBottom: 0 }}>
            <HardDrive size={15} color="var(--accent)" /> Storage Retention & Cleanup
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              disabled={busy === 'cleanup-preview'}
              onClick={() => void handleCleanup(true)}
            >
              Preview Cleanup
            </button>
            <button
              className="btn btn-primary"
              disabled={busy === 'cleanup-run'}
              onClick={() => void handleCleanup(false)}
            >
              <Sparkles size={14} /> {busy === 'cleanup-run' ? 'Cleaning...' : 'Run Cleanup Now'}
            </button>
          </div>
        </div>

        {cleanupStatus && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 14px',
              borderRadius: 10,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: 13,
              }}
            >
              <span>
                <strong>{formatBytes(cleanupStatus.totalRecordingsBytes)}</strong> used across{' '}
                <strong>{cleanupStatus.totalRecordingsCount}</strong> recording(s)
                {settings.maxStorageGb > 0 ? ` / ${settings.maxStorageGb} GB quota` : ' (Unlimited)'}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {cleanupStatus.protectedCount} locked / keep forever · {eligibleCount} eligible for
                cleanup ({formatBytes(cleanupStatus.preview.bytesFreed)})
              </span>
            </div>

            {settings.maxStorageGb > 0 && (
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${quotaPct}%` }} />
              </div>
            )}

            {(lastCleanupResult ?? cleanupStatus.lastReport) && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {(() => {
                  const r = lastCleanupResult ?? cleanupStatus.lastReport!;
                  return `${r.dryRun ? 'Preview' : 'Last cleanup'} (${new Date(r.ranAt).toLocaleTimeString()}): ${r.expiredDeleted} expired, ${r.watchedDeleted} watched, ${r.quotaDeleted} over-quota, ${r.orphansRemoved} temp/orphan files · ${formatBytes(r.bytesFreed)}`;
                })()}
              </div>
            )}
          </div>
        )}

        <div className="form-grid">
          <div className="field">
            <label>Default How Long to Save Recordings</label>
            <select
              value={settings.defaultRetentionDays}
              onChange={(e) =>
                setSettings({ ...settings, defaultRetentionDays: Number(e.target.value) })
              }
            >
              {RETENTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Auto-Delete Watched Shows After</label>
            <select
              value={settings.deleteWatchedAfterDays}
              onChange={(e) =>
                setSettings({ ...settings, deleteWatchedAfterDays: Number(e.target.value) })
              }
            >
              <option value={0}>Never (follow normal keep days)</option>
              <option value={1}>1 Day</option>
              <option value={3}>3 Days</option>
              <option value={7}>7 Days</option>
              <option value={14}>14 Days</option>
              <option value={30}>30 Days</option>
            </select>
          </div>

          <div className="field">
            <label>Max DVR Storage Quota (GB, 0 = Unlimited)</label>
            <input
              type="number"
              min={0}
              max={50000}
              value={settings.maxStorageGb}
              onChange={(e) =>
                setSettings({ ...settings, maxStorageGb: Math.max(0, Number(e.target.value)) })
              }
            />
          </div>

          <div className="field">
            <label>Automatic Cleanup Schedule</label>
            <select
              value={settings.cleanupIntervalHours}
              onChange={(e) =>
                setSettings({ ...settings, cleanupIntervalHours: Number(e.target.value) })
              }
            >
              <option value={1}>Every Hour</option>
              <option value={6}>Every 6 Hours</option>
              <option value={12}>Every 12 Hours</option>
              <option value={24}>Daily (Every 24 Hours)</option>
            </select>
          </div>
        </div>
      </section>

      {/* OTA Tuners Section */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <h2 className="section-heading" style={{ marginBottom: 0 }}>
            <Antenna size={15} color="var(--accent)" /> OTA Tuners
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              disabled={busy === 'discover'}
              onClick={() => void handleDiscoverHdhr()}
            >
              <Radio size={14} /> {busy === 'discover' ? 'Scanning...' : 'Auto-Discover HDHomeRun'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                await api.enableVirtualTuner(settings.virtualTunerCount || 2);
                onNotify('Virtual OTA Simulator enabled with 8 ATSC test channels');
                onRefresh();
              }}
            >
              Enable Virtual Simulator
            </button>
          </div>
        </div>

        <form
          onSubmit={(e) => void handleAddHdhr(e)}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          <input
            type="text"
            placeholder="Manual HDHomeRun IP (e.g. 192.168.1.50)"
            value={hdhrHost}
            onChange={(e) => setHdhrHost(e.target.value)}
            style={{ flex: 1, minWidth: 230 }}
          />
          <button type="submit" className="btn btn-secondary" disabled={busy === 'add-hdhr'}>
            Add by IP
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tuners.map(({ tuner, activeLeases, freeSlots }) => (
            <div
              key={tuner.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '11px 14px',
                borderRadius: 10,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{tuner.name}</span>
                  <span className="pill pill-hd">{tuner.type.toUpperCase()}</span>
                  <span className="pill pill-ok">
                    {freeSlots}/{tuner.tunerCount} free
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {tuner.modelNumber} · {tuner.host} · {activeLeases.length} active
                </div>
              </div>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await api.deleteTuner(tuner.id);
                  onNotify(`Removed tuner "${tuner.name}"`);
                  onRefresh();
                }}
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* XMLTV EPG Section */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 className="section-heading" style={{ marginBottom: 0 }}>
          <Download size={15} color="var(--accent)" /> TV Guide Data (XMLTV)
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="https://example.com/guide.xml.gz or local /path/to/xmltv.xml"
            value={xmltvInput}
            onChange={(e) => setXmltvInput(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button
            className="btn btn-primary"
            disabled={busy === 'xmltv'}
            onClick={() => void handleImportXmltv()}
          >
            <RefreshCw size={14} /> {busy === 'xmltv' ? 'Importing...' : 'Import XMLTV'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              const res = await api.generateSampleGuide(48);
              onNotify(`Generated ${res.programCount} guide entries across ${res.channelCount} channels`);
              onRefresh();
            }}
          >
            Generate 48h Sample
          </button>
        </div>
      </section>

      {/* Commercial Skipping & Recording Preferences */}
      <form
        className="card"
        onSubmit={(e) => void handleSaveSettings(e)}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 className="section-heading" style={{ marginBottom: 0 }}>
          <Scissors size={15} color="var(--accent)" /> Recording & Commercial Skip Preferences
        </h2>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className={`pill ${caps.ffmpegAvailable ? 'pill-ok' : 'pill-ad'}`}>
            <CheckCircle2 size={11} /> FFmpeg: {caps.ffmpegAvailable ? 'Ready' : 'Not installed'}
          </span>
          <span className={`pill ${caps.comskipAvailable ? 'pill-ok' : 'pill-ad'}`}>
            <Scissors size={11} /> Comskip:{' '}
            {caps.comskipAvailable ? 'Ready' : 'FFmpeg fallback analyzer'}
          </span>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Server Name</label>
            <input
              value={settings.serverName}
              onChange={(e) => setSettings({ ...settings, serverName: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Start Padding (minutes)</label>
            <input
              type="number"
              min={0}
              max={15}
              value={settings.defaultPaddingStartMin}
              onChange={(e) =>
                setSettings({ ...settings, defaultPaddingStartMin: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>End Padding (minutes)</label>
            <input
              type="number"
              min={0}
              max={60}
              value={settings.defaultPaddingEndMin}
              onChange={(e) =>
                setSettings({ ...settings, defaultPaddingEndMin: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Comskip Path</label>
            <input
              value={settings.comskipPath}
              onChange={(e) => setSettings({ ...settings, comskipPath: e.target.value })}
            />
          </div>
          <div className="field">
            <label>FFmpeg Path</label>
            <input
              value={settings.ffmpegPath}
              onChange={(e) => setSettings({ ...settings, ffmpegPath: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Auto-Scan Commercials</label>
            <select
              value={settings.autoCommercialScan ? 'yes' : 'no'}
              onChange={(e) =>
                setSettings({ ...settings, autoCommercialScan: e.target.value === 'yes' })
              }
            >
              <option value="yes">Enabled</option>
              <option value="no">Manual Only</option>
            </select>
          </div>
          <div className="field">
            <label>Auto-Skip During Playback</label>
            <select
              value={settings.autoSkipCommercialsDefault ? 'yes' : 'no'}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  autoSkipCommercialsDefault: e.target.value === 'yes',
                })
              }
            >
              <option value="yes">Auto-Skip Enabled</option>
              <option value="no">Manual Skip Button</option>
            </select>
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn-primary" disabled={busy === 'save'}>
            <Save size={14} /> Save All DVR Settings
          </button>
        </div>
      </form>
    </>
  );
}
