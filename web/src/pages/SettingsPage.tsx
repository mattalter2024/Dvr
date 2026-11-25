import { useEffect, useState } from 'react';
import {
  Antenna,
  CheckCircle2,
  Download,
  Radio,
  RefreshCw,
  Save,
  Scissors,
  Trash2,
  Tv2,
} from 'lucide-react';
import {
  api,
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
  const [hdhrHost, setHdhrHost] = useState('');
  const [xmltvInput, setXmltvInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadSettings = async () => {
    const res = await api.getSettings();
    setSettings(res.settings);
    setCaps(res.capabilities);
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
        onNotify(`Discovered ${res.discovered.length} HDHomeRun tuner(s) on your home network!`);
      } else {
        onNotify('No HDHomeRun devices responded to UDP broadcast. You can enter its IP manually.');
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
      onNotify('DVR settings saved');
      onRefresh();
    } finally {
      setBusy(null);
    }
  };

  if (!settings || !caps) {
    return <div className="card">Loading DVR configuration...</div>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tuners, EPG & Commercial Skip Settings</h1>
          <p className="page-subtitle">
            Connect HDHomeRun OTA tuners, configure XMLTV guide feeds, and pair Android TV / Fire TV clients
          </p>
        </div>
      </div>

      {/* Whole-House Smart TV Connection Card */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tv2 size={18} color="var(--accent)" /> Connect Android TV, Google TV & Fire TV Apps
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          The native Android TV / Fire TV app automatically discovers this server on your home Wi-Fi
          via UDP port <code>{caps.discoveryUdpPort}</code>. You can also connect manually using any
          LAN address below:
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {caps.lanAddresses.map((ip) => (
            <div
              key={ip}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                background: 'var(--bg-elevated)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                fontFamily: 'monospace',
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--accent)',
              }}
            >
              http://{ip}:{caps.port}
            </div>
          ))}
        </div>
      </section>

      {/* OTA Tuners Section */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Antenna size={18} color="var(--accent)" /> OTA Tuners (HDHomeRun + Simulator)
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              disabled={busy === 'discover'}
              onClick={() => void handleDiscoverHdhr()}
            >
              <Radio size={15} /> {busy === 'discover' ? 'Scanning LAN...' : 'Auto-Discover HDHomeRun'}
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

        <form onSubmit={(e) => void handleAddHdhr(e)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Manual HDHomeRun IP (e.g. 192.168.1.50)"
            value={hdhrHost}
            onChange={(e) => setHdhrHost(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <button type="submit" className="btn btn-secondary" disabled={busy === 'add-hdhr'}>
            Add HDHomeRun by IP
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tuners.map(({ tuner, activeLeases, freeSlots }) => (
            <div
              key={tuner.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 12,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{tuner.name}</strong>
                  <span className="pill pill-hd">{tuner.type.toUpperCase()}</span>
                  <span className="pill pill-ok">
                    {freeSlots}/{tuner.tunerCount} tuners free
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Model: {tuner.modelNumber} · Host: {tuner.host} · Active streams: {activeLeases.length}
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
                <Trash2 size={14} /> Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* XMLTV EPG Section */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Download size={18} color="var(--accent)" /> TV Guide Data (XMLTV / Sample Generator)
        </h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="https://example.com/guide.xml.gz or local /path/to/xmltv.xml"
            value={xmltvInput}
            onChange={(e) => setXmltvInput(e.target.value)}
            style={{ flex: 1, minWidth: 280 }}
          />
          <button
            className="btn btn-primary"
            disabled={busy === 'xmltv'}
            onClick={() => void handleImportXmltv()}
          >
            <RefreshCw size={15} /> {busy === 'xmltv' ? 'Importing...' : 'Import XMLTV'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              const res = await api.generateSampleGuide(48);
              onNotify(`Generated ${res.programCount} sample guide programs across ${res.channelCount} channels`);
              onRefresh();
            }}
          >
            Generate 48h Sample Guide
          </button>
        </div>
      </section>

      {/* Commercial Skipping & Recording Preferences */}
      <form
        className="card"
        onSubmit={(e) => void handleSaveSettings(e)}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Scissors size={18} color="#f59e0b" /> Commercial Skipping & DVR Preferences
        </h2>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span className={`pill ${caps.ffmpegAvailable ? 'pill-ok' : 'pill-ad'}`}>
            <CheckCircle2 size={12} /> FFmpeg: {caps.ffmpegAvailable ? 'Detected' : 'Not installed'}
          </span>
          <span className={`pill ${caps.comskipAvailable ? 'pill-ok' : 'pill-ad'}`}>
            <Scissors size={12} /> Comskip:{' '}
            {caps.comskipAvailable ? 'Detected' : 'Fallback to FFmpeg black/silence analyzer'}
          </span>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Server Display Name</label>
            <input
              value={settings.serverName}
              onChange={(e) => setSettings({ ...settings, serverName: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Default Start Padding (minutes)</label>
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
            <label>Default End Padding (minutes)</label>
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
            <label>Comskip Binary Path</label>
            <input
              value={settings.comskipPath}
              onChange={(e) => setSettings({ ...settings, comskipPath: e.target.value })}
            />
          </div>
          <div className="field">
            <label>FFmpeg Binary Path</label>
            <input
              value={settings.ffmpegPath}
              onChange={(e) => setSettings({ ...settings, ffmpegPath: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Auto-Scan Commercials After Recording</label>
            <select
              value={settings.autoCommercialScan ? 'yes' : 'no'}
              onChange={(e) =>
                setSettings({ ...settings, autoCommercialScan: e.target.value === 'yes' })
              }
            >
              <option value="yes">Enabled (Recommended)</option>
              <option value="no">Manual Only</option>
            </select>
          </div>
          <div className="field">
            <label>Auto-Skip Commercials During Playback</label>
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
              <option value="no">Show Skip Button Only</option>
            </select>
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn-primary" disabled={busy === 'save'}>
            <Save size={16} /> Save Settings
          </button>
        </div>
      </form>
    </>
  );
}
