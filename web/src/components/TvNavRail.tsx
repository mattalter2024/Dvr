import { useEffect, useState } from 'react';
import {
  CalendarClock,
  Film,
  Home,
  LayoutGrid,
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

export type NavTab = 'home' | 'guide' | 'recordings' | 'apps' | 'schedule' | 'settings';

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
    { id: 'home', label: 'Home', icon: Home },
    {
      id: 'recordings',
      label: 'My Shows',
      icon: Film,
      badge: activeRecordingsCount > 0 ? activeRecordingsCount : undefined,
    },
    { id: 'guide', label: 'Guide', icon: Tv },
    { id: 'apps', label: 'Streaming Apps', icon: LayoutGrid },
    { id: 'schedule', label: 'To Do & OnePass', icon: CalendarClock },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="tv-rail" aria-label="Main Navigation">
      <div className="brand-lockup">
        <div className="tivo-mascot">
          <Radio size={16} color="var(--accent)" />
        </div>
        <div>
          <div className="brand-title">AirVault</div>
          <div className="brand-sub">{clock}</div>
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
            <Icon size={17} />
            <span>{item.label}</span>
            {item.badge !== undefined && <span className="nav-badge">{item.badge}</span>}
          </button>
        );
      })}

      <div className="rail-footer">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{serverName}</span>
          <button
            onClick={() => {
              const next = !soundsOn;
              setSoundsOn(next);
              setTivoSoundsEnabled(next);
              if (next) playTivoNavBloop();
            }}
            title={soundsOn ? 'Mute UI sounds' : 'Enable subtle TiVo UI sounds'}
            style={{ padding: 5, borderRadius: 6 }}
          >
            {soundsOn ? (
              <Volume2 size={14} color="var(--accent)" />
            ) : (
              <VolumeX size={14} color="var(--text-muted)" />
            )}
          </button>
        </div>

        <div className="tuner-pill">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span className={`dot ${activeRecordingsCount > 0 ? 'rec' : 'live'}`} />
            Tuners
          </span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {usedSlots}/{totalSlots}
          </span>
        </div>
      </div>
    </aside>
  );
}
