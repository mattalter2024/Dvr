// Classic TiVo-inspired subtle Web Audio UI feedback tones (boop, select chime, SkipMode chime)

let audioCtx: AudioContext | null = null;
let soundsEnabled = true;

export function setTivoSoundsEnabled(enabled: boolean): void {
  soundsEnabled = enabled;
}

export function isTivoSoundsEnabled(): boolean {
  return soundsEnabled;
}

function getCtx(): AudioContext | null {
  if (!soundsEnabled || typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  freqStart: number,
  freqEnd: number,
  durationSec: number,
  gainPeak = 0.055,
  delaySec = 0,
): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freqStart, now);
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(freqEnd, now + durationSec);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

/** Gentle classic TiVo menu step "bloop" */
export function playTivoNavBloop(): void {
  playTone(520, 620, 0.065, 0.04);
}

/** Upbeat two-note TiVo confirm / thumbs-up chime */
export function playTivoSelectChime(): void {
  playTone(587.33, 587.33, 0.08, 0.05, 0);
  playTone(880, 920, 0.12, 0.055, 0.065);
}

/** Iconic ascending three-note TiVo SkipMode commercial jump chime */
export function playTivoSkipChime(): void {
  playTone(523.25, 523.25, 0.07, 0.05, 0);
  playTone(659.25, 659.25, 0.07, 0.05, 0.06);
  playTone(1046.5, 1080, 0.14, 0.06, 0.12);
}

/** Warm red-button recording confirmation tone */
export function playTivoRecordTone(): void {
  playTone(440, 660, 0.11, 0.05, 0);
  playTone(660, 880, 0.14, 0.05, 0.09);
}

/** Soft descending TiVo back/cancel boop */
export function playTivoBackBoop(): void {
  playTone(480, 340, 0.085, 0.045);
}
