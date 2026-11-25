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
import { useState } from 'react';
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
  const [soundsOn, setSoundsOn] = useState(() => isTivoSoundsEnabled());

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
      <div className="brand-lockup" title={serverName}>
        <div className="tivo-mascot">
          <Radio size={17} color="var(--accent)" />
        </div>
      </div>

      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            title={item.label}
            aria-label={item.label}
            onClick={() => {
              playTivoNavBloop();
              onSelect(item.id);
            }}
          >
            <Icon size={19} />
            {item.badge !== undefined && <span className="nav-rec-dot" />}
          </button>
        );
      })}

      <div className="rail-footer">
        <button
          className="nav-item"
          onClick={() => {
            const next = !soundsOn;
            setSoundsOn(next);
            setTivoSoundsEnabled(next);
            if (next) playTivoNavBloop();
          }}
          title={soundsOn ? 'Mute UI sounds' : 'Enable subtle UI sounds'}
          aria-label={soundsOn ? 'Mute UI sounds' : 'Enable subtle UI sounds'}
        >
          {soundsOn ? (
            <Volume2 size={16} color="var(--accent)" />
          ) : (
            <VolumeX size={16} color="var(--text-muted)" />
          )}
        </button>

        <div
          className="rail-tuner-dot"
          title={`${serverName} · Tuners: ${usedSlots}/${totalSlots} active`}
        >
          <span className={`dot ${activeRecordingsCount > 0 ? 'rec' : 'live'}`} />
        </div>
      </div>
    </aside>
  );
}
