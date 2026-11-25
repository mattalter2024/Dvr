import { useEffect, useState } from 'react';
import {
  CalendarClock,
  Film,
  Home,
  Radio,
  Settings,
  Tv,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { TunerUtilization } from '../api/client';
import {
  isTivoSoundsEnabled,
  playTivoNavBloop,
  setTivoSoundsEnabled,
} from '../utils/tivoSounds';

export type NavTab = 'home' | 'guide' | 'recordings' | 'schedule' | 'settings';

interface TvNavRailProps {
  activeTab: NavTab;
  onSelect: (tab: NavTab) => void;
  activeRecordingsCount: number;
  tuners: TunerUtilization[];
  serverName: string;
}

export function TvNavRail({
  activeTab,
  onSelect,
  activeRecordingsCount,
  tuners,
  serverName,
}: TvNavRailProps) {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  );
  const [soundsOn, setSoundsOn] = useState(() => isTivoSoundsEnabled());

  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }, 15_000);
    return () => window.clearInterval(id);
  }, []);

  const totalSlots = tuners.reduce((acc, t) => acc + (t.tuner.enabled ? t.tuner.tunerCount : 0), 0);
  const usedSlots = tuners.reduce((acc, t) => acc + t.activeLeases.length, 0);

  const items: Array<{ id: NavTab; label: string; icon: typeof Home; badge?: number }> = [
    { id: 'home', label: 'TiVo Central', icon: Home },
    {
      id: 'recordings',
      label: 'My Shows',
      icon: Film,
      badge: activeRecordingsCount > 0 ? activeRecordingsCount : undefined,
    },
    { id: 'guide', label: 'Live TV Guide', icon: Tv },
    { id: 'schedule', label: 'To Do & OnePass', icon: CalendarClock },
    { id: 'settings', label: 'Tuners & Setup', icon: Settings },
  ];

  return (
    <aside className="tv-rail" aria-label="TiVo Central Navigation">
      <div className="brand-lockup">
        <div className="tivo-mascot">
          <Radio size={23} color="#fff" />
        </div>
        <div>
          <div className="brand-title">AirVault</div>
          <div className="brand-sub">TiVo-Style DVR · {clock}</div>
        </div>
      </div>

      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => {
              playTivoNavBloop();
              onSelect(item.id);
            }}
          >
            <Icon size={20} />
            <span>{item.label}</span>
            {item.badge !== undefined && <span className="nav-badge">REC {item.badge}</span>}
          </button>
        );
      })}

      <div className="rail-footer">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{serverName}</span>
          <button
            onClick={() => {
              const next = !soundsOn;
              setSoundsOn(next);
              setTivoSoundsEnabled(next);
              if (next) playTivoNavBloop();
            }}
            title={soundsOn ? 'Mute TiVo UI sounds' : 'Enable TiVo UI sounds'}
            style={{
              padding: 6,
              borderRadius: 8,
              background: 'rgba(15, 42, 98, 0.8)',
              border: '1px solid var(--tivo-border)',
            }}
          >
            {soundsOn ? <Volume2 size={14} color="#facc15" /> : <VolumeX size={14} color="#7995c4" />}
          </button>
        </div>

        <div className="tuner-pill">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span className={`dot ${activeRecordingsCount > 0 ? 'rec' : 'live'}`} />
            OTA Tuners
          </span>
          <strong style={{ color: '#facc15' }}>
            {usedSlots} / {totalSlots} active
          </strong>
        </div>

        {tuners.flatMap((u) => u.activeLeases).slice(0, 2).map((lease) => (
          <div
            key={lease.id}
            style={{
              fontSize: 11,
              color: lease.purpose === 'recording' ? '#fca5a5' : '#86efac',
              padding: '4px 8px',
              borderRadius: 8,
              background: 'rgba(4, 15, 40, 0.7)',
              border: '1px solid var(--tivo-border)',
            }}
          >
            Tuner {lease.tunerSlot + 1}: {lease.purpose === 'recording' ? '● REC' : '▶ LIVE'} Ch{' '}
            {lease.channelNumber}
          </div>
        ))}

        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          D-pad Arrows · D = SkipMode · ← = 8s Replay
        </div>
      </div>
    </aside>
  );
}
