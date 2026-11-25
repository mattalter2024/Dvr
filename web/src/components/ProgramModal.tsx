import { useState } from 'react';
import { CircleDot, Play, Repeat, X } from 'lucide-react';
import {
  formatTime,
  getProgramScreenshotUrl,
  RETENTION_OPTIONS,
  type Channel,
  type Program,
} from '../api/client';

interface ProgramModalProps {
  channel: Channel;
  program: Program;
  defaultRetentionDays?: number;
  existingRecordingStatus?: string;
  onClose: () => void;
  onWatchLive: (channel: Channel) => void;
  onRecordEpisode: (program: Program, keepDays?: number) => void;
  onCreateSeriesPass: (program: Program, newOnly: boolean, keepDays?: number) => void;
}

export function ProgramModal({
  channel,
  program,
  defaultRetentionDays = 30,
  existingRecordingStatus,
  onClose,
  onWatchLive,
  onRecordEpisode,
  onCreateSeriesPass,
}: ProgramModalProps) {
  const [keepDays, setKeepDays] = useState<number>(defaultRetentionDays);
  const now = Date.now();
  const isAiringNow = Date.parse(program.startTime) <= now && Date.parse(program.endTime) > now;
  const shotUrl = getProgramScreenshotUrl(program, channel);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ padding: 0, overflow: 'hidden', gap: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="show-shot-wrap" style={{ maxHeight: 240 }}>
          <img src={shotUrl} alt={program.title} className="show-shot-img" />
          <div className="show-shot-overlay">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span
                className="pill"
                style={{ background: 'rgba(7, 11, 20, 0.78)', color: '#eef2f8' }}
              >
                {channel.guideNumber} {channel.guideName}
              </span>
              {program.isLive && <span className="pill pill-live">Live</span>}
              {program.isNew && <span className="pill pill-new">New</span>}
            </div>
            <button
              className="btn btn-secondary"
              style={{
                pointerEvents: 'auto',
                padding: 6,
                background: 'rgba(7, 11, 20, 0.72)',
              }}
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span className="pill pill-hd">{program.category}</span>
              {program.episodeNum && <span className="pill pill-hd">{program.episodeNum}</span>}
              {existingRecordingStatus && <span className="tivo-rec-badge">R</span>}
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {formatTime(program.startTime)} – {formatTime(program.endTime)}
                {program.rating ? ` · ${program.rating}` : ''}
              </span>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>{program.title}</h2>
            {program.subtitle && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 2 }}>
                {program.subtitle}
              </div>
            )}
          </div>

          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: 13 }}>
            {program.description || 'Over-the-air broadcast television program.'}
          </p>

          {/* How long to save this recording */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label
              htmlFor="modal-keep-days"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}
            >
              Save recording for:
            </label>
            <select
              id="modal-keep-days"
              value={keepDays}
              onChange={(e) => setKeepDays(Number(e.target.value))}
              style={{ padding: '6px 10px', fontSize: 13 }}
            >
              {RETENTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
            {isAiringNow && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  onWatchLive(channel);
                }}
              >
                <Play size={14} /> Watch Live
              </button>
            )}
            <button
              className="btn btn-danger"
              onClick={() => {
                onRecordEpisode(program, keepDays);
                onClose();
              }}
            >
              <CircleDot size={14} /> {existingRecordingStatus ? 'Scheduled' : 'Record Episode'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                onCreateSeriesPass(program, true, keepDays);
                onClose();
              }}
            >
              <Repeat size={14} /> OnePass (New)
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                onCreateSeriesPass(program, false, keepDays);
                onClose();
              }}
            >
              <Repeat size={14} /> OnePass (All)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
