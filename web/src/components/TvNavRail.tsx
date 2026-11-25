import { CalendarClock, Film, Home, Radio, Settings, Tv } from 'lucide-react';
import type { TunerUtilization } from '../api/client';

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
  const totalSlots = tuners.reduce((acc, t) => acc + (t.tuner.enabled ? t.tuner.tunerCount : 0), 0);
  const usedSlots = tuners.reduce((acc, t) => acc + t.activeLeases.length, 0);

  const items: Array<{ id: NavTab; label: string; icon: typeof Home; badge?: number }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'guide', label: 'Live TV Guide', icon: Tv },
    {
      id: 'recordings',
      label: 'Recordings',
      icon: Film,
      badge: activeRecordingsCount > 0 ? activeRecordingsCount : undefined,
    },
    { id: 'schedule', label: 'Schedule & Passes', icon: CalendarClock },
    { id: 'settings', label: 'Tuners & Settings', icon: Settings },
  ];

  return (
    <aside className="tv-rail" aria-label="Main TV Navigation">
      <div className="brand-lockup">
        <div className="brand-icon">
          <Radio size={22} color="#fff" />
        </div>
        <div>
          <div className="brand-title">AirVault</div>
          <div className="brand-sub">Whole-House DVR</div>
        </div>
      </div>

      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <Icon size={20} />
            <span>{item.label}</span>
            {item.badge !== undefined && <span className="nav-badge">REC {item.badge}</span>}
          </button>
        );
      })}

      <div className="rail-footer">
        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{serverName}</div>
        <div className="tuner-pill">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className={`dot ${activeRecordingsCount > 0 ? 'rec' : 'live'}`} />
            OTA Tuners
          </span>
          <strong style={{ color: 'var(--text-primary)' }}>
            {usedSlots} / {totalSlots} active
          </strong>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          D-pad / Arrow keys supported
        </div>
      </div>
    </aside>
  );
}
