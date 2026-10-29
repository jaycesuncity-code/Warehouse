/** Small sensory feedback for scans: a short beep and a buzz. Everything is best-effort. */
let audio: AudioContext | null = null;

export function beep(kind: 'ok' | 'bad' = 'ok'): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = kind === 'ok' ? 1040 : 330;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (kind === 'ok' ? 0.12 : 0.28));
  } catch {
    /* no audio: fine */
  }
}

export function buzz(kind: 'ok' | 'bad' = 'ok'): void {
  try {
    navigator.vibrate?.(kind === 'ok' ? 60 : [80, 60, 80]);
  } catch {
    /* no vibration: fine */
  }
}

export function scanFeedback(kind: 'ok' | 'bad' = 'ok'): void {
  beep(kind);
  buzz(kind);
}
