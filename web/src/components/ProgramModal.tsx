import { CircleDot, Play, Repeat, X } from 'lucide-react';
import { formatTime, type Channel, type Program } from '../api/client';

interface ProgramModalProps {
  channel: Channel;
  program: Program;
  existingRecordingStatus?: string;
  onClose: () => void;
  onWatchLive: (channel: Channel) => void;
  onRecordEpisode: (program: Program) => void;
  onCreateSeriesPass: (program: Program, newOnly: boolean) => void;
}

export function ProgramModal({
  channel,
  program,
  existingRecordingStatus,
  onClose,
  onWatchLive,
  onRecordEpisode,
  onCreateSeriesPass,
}: ProgramModalProps) {
  const now = Date.now();
  const isAiringNow = Date.parse(program.startTime) <= now && Date.parse(program.endTime) > now;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="pill pill-hd">
                {channel.guideNumber} {channel.guideName}
              </span>
              <span className="pill pill-hd">{program.category}</span>
              {program.episodeNum && <span className="pill pill-hd">{program.episodeNum}</span>}
              {program.isNew && <span className="pill pill-new">NEW</span>}
              {program.isLive && <span className="pill pill-live">LIVE</span>}
              {existingRecordingStatus && (
                <span className="pill pill-live">● {existingRecordingStatus.toUpperCase()}</span>
              )}
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 800 }}>{program.title}</h2>
            {program.subtitle && (
              <div style={{ color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>
                {program.subtitle}
              </div>
            )}
          </div>
          <button className="btn btn-secondary" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          {formatTime(program.startTime)} – {formatTime(program.endTime)}
          {program.rating ? ` · ${program.rating}` : ''}
        </div>

        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.55, fontSize: 15 }}>
          {program.description || 'Over-the-air broadcast television program.'}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 6 }}>
          {isAiringNow && (
            <button
              className="btn btn-primary"
              onClick={() => {
                onClose();
                onWatchLive(channel);
              }}
            >
              <Play size={16} /> Watch Live Now
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={() => {
              onRecordEpisode(program);
              onClose();
            }}
          >
            <CircleDot size={16} /> {existingRecordingStatus ? 'Already Scheduled' : 'Record Episode'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              onCreateSeriesPass(program, true);
              onClose();
            }}
          >
            <Repeat size={16} /> Series Pass (New)
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              onCreateSeriesPass(program, false);
              onClose();
            }}
          >
            <Repeat size={16} /> Series Pass (All)
          </button>
        </div>
      </div>
    </div>
  );
}
