// Optional subtle TiVo-inspired Web Audio UI feedback tones (OFF by default for a calm experience)

let audioCtx: AudioContext | null = null;
let soundsEnabled = false;

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
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
  gainPeak = 0.035,
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

export function playTivoNavBloop(): void {
  playTone(500, 560, 0.055, 0.025);
}

export function playTivoSelectChime(): void {
  playTone(560, 560, 0.065, 0.03, 0);
  playTone(780, 800, 0.09, 0.035, 0.055);
}

export function playTivoSkipChime(): void {
  playTone(523.25, 523.25, 0.06, 0.03, 0);
  playTone(659.25, 659.25, 0.06, 0.03, 0.055);
  playTone(880, 900, 0.1, 0.035, 0.11);
}

export function playTivoRecordTone(): void {
  playTone(440, 587, 0.09, 0.03, 0);
}

export function playTivoBackBoop(): void {
  playTone(440, 330, 0.07, 0.028);
}
