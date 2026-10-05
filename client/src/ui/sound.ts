let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem('zsa-muted') === '1';
} catch {
  /* storage unavailable */
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Shared audio context for the music engine (null while muted). */
export const audioCtx = () => audio();

const unlockHooks: (() => void)[] = [];
export const onUnlock = (fn: () => void) => unlockHooks.push(fn);

const muteHooks: ((m: boolean) => void)[] = [];
export const onMuteChange = (fn: (m: boolean) => void) => muteHooks.push(fn);

/** Must be called from a user gesture once so browsers allow sound. */
export function unlockAudio() {
  audio();
  unlockHooks.forEach((fn) => fn());
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem('zsa-muted', value ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  muteHooks.forEach((fn) => fn(value));
}

export const isMuted = () => muted;

const lastPlayed: Record<string, number> = {};
/** Drops a sound that repeats faster than `ms` (e.g. twenty robots landing at once). */
function throttled(key: string, ms: number) {
  const now = performance.now();
  if (now - (lastPlayed[key] ?? -1e9) < ms) return false;
  lastPlayed[key] = now;
  return true;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.18, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(start: number, dur: number, gain = 0.15, type: BiquadFilterType = 'lowpass', freq = 900, freqTo?: number) {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = type;
  const t0 = a.currentTime + start;
  filter.frequency.setValueAtTime(freq, t0);
  if (freqTo) filter.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

export const sfx = {
  // --- question flow
  questionStart: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.18, 'triangle', 0.16)),
  countdown: (last = false) => tone(last ? 1046 : 880, 0, last ? 0.35 : 0.12, 'square', 0.08),
  tick: () => throttled('tick', 40) && tone(1500, 0, 0.04, 'square', 0.05),
  select: () => tone(660, 0, 0.12, 'triangle', 0.2, 990),
  tap: () => throttled('tap', 60) && tone(420, 0, 0.06, 'triangle', 0.1, 560),
  lock: () => tone(220, 0, 0.25, 'sawtooth', 0.07, 110),
  whoosh: () => noise(0, 0.5, 0.18, 'bandpass', 300, 2600),
  drumroll: () => {
    for (let i = 0; i < 26; i++) noise(i * 0.055, 0.05, 0.05 + i * 0.004, 'lowpass', 500);
  },
  nextRound: () => {
    noise(0, 0.4, 0.14, 'bandpass', 2400, 400);
    [392, 523].forEach((f, i) => tone(f, 0.1 + i * 0.1, 0.2, 'triangle', 0.1));
  },
  // --- results
  correct: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.08, 0.22, 'triangle', 0.15)),
  wrong: () => [330, 262].forEach((f, i) => tone(f, i * 0.16, 0.3, 'sawtooth', 0.08)),
  gasp: () => {
    noise(0, 0.35, 0.12, 'bandpass', 500, 1800);
    tone(300, 0, 0.35, 'sawtooth', 0.04, 700);
  },
  cheer: () => {
    noise(0, 1.1, 0.12, 'bandpass', 1800, 1200);
    [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.07, 0.25, 'triangle', 0.09));
  },
  reveal: () => [1318, 1568, 2093].forEach((f, i) => tone(f, i * 0.06, 0.2, 'triangle', 0.09)),
  chime: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.1, 0.35, 'sine', 0.14)),
  platformOpen: () => {
    noise(0, 0.5, 0.25);
    tone(140, 0, 0.45, 'square', 0.06, 60);
  },
  thud: () => {
    noise(0, 0.35, 0.3);
    tone(80, 0, 0.4, 'sine', 0.3, 35);
  },
  fall: () => tone(900, 0.15, 1.1, 'sine', 0.12, 120),
  // --- robots
  land: (power = 0.6) => {
    if (!throttled('land', 90)) return;
    tone(110, 0, 0.18, 'sine', 0.25 * power, 45);
    noise(0, 0.12, 0.12 * power);
  },
  hop: () => throttled('hop', 70) && tone(480, 0, 0.1, 'sine', 0.06, 880),
  // --- power-ups
  powerup: () => [523, 784, 1046].forEach((f, i) => tone(f, i * 0.06, 0.16, 'square', 0.1, f * 1.5)),
  pickup: () => [880, 1175, 1568, 1976].forEach((f, i) => tone(f, i * 0.07, 0.18, 'triangle', 0.14)),
  iceCrack: () => {
    noise(0, 0.12, 0.2);
    tone(1800, 0, 0.08, 'square', 0.05, 900);
  },
  squelch: () => tone(180 + Math.random() * 80, 0, 0.12, 'sawtooth', 0.05, 90),
  explosion: () => {
    noise(0, 0.6, 0.3);
    tone(120, 0, 0.5, 'sawtooth', 0.12, 40);
  },
  shield: () => [660, 880].forEach((f, i) => tone(f, i * 0.1, 0.25, 'sine', 0.14)),
  // --- catapult & co
  launch: () => {
    tone(180, 0, 0.35, 'sawtooth', 0.1, 70); // spring wound up
    tone(220, 0.4, 0.7, 'sawtooth', 0.12, 1400); // rising scream of the flight
    noise(0.4, 0.7, 0.2, 'bandpass', 400, 3000);
  },
  splat: () => {
    noise(0, 0.5, 0.4, 'lowpass', 1400, 200);
    tone(70, 0, 0.5, 'sine', 0.4, 30);
    noise(0.05, 0.35, 0.18, 'highpass', 3500); // glass
    [1200, 900, 1500].forEach((f, i) => tone(f, 0.05 + i * 0.05, 0.12, 'square', 0.04));
  },
  slide: () => tone(900, 0, 0.9, 'sine', 0.03, 300),
  freeze: () => [2400, 3100, 2700].forEach((f, i) => tone(f, i * 0.06, 0.2, 'triangle', 0.05)),
  slap: () => {
    noise(0, 0.12, 0.45, 'bandpass', 2600, 1200);
    tone(260, 0, 0.14, 'square', 0.12, 90);
  },
  dizzy: () => [700, 500, 650, 420, 560, 360].forEach((f, i) => tone(f, i * 0.09, 0.12, 'sine', 0.06)),
  // --- show
  mutator: () => {
    noise(0, 0.5, 0.2, 'bandpass', 200, 2200);
    [262, 330, 392, 523].forEach((f, i) => tone(f, 0.15 + i * 0.09, 0.3, 'sawtooth', 0.07));
  },
  react: () => throttled('react', 90) && tone(900 + Math.random() * 500, 0, 0.12, 'sine', 0.06, 1500),
  streak: () => [659, 880, 1175].forEach((f, i) => tone(f, i * 0.07, 0.2, 'square', 0.07)),
  podium: (place: number) => tone(place === 1 ? 784 : place === 2 ? 659 : 523, 0, 0.5, 'triangle', 0.16),
  intro: () => [392, 523, 659].forEach((f, i) => tone(f, i * 0.1, 0.22, 'triangle', 0.14)),
  pause: () => [660, 440].forEach((f, i) => tone(f, i * 0.1, 0.15, 'triangle', 0.1)),
  resume: () => [440, 660].forEach((f, i) => tone(f, i * 0.1, 0.15, 'triangle', 0.1)),
  victory: () =>
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.14, i === 6 ? 0.8 : 0.2, 'triangle', 0.16)),
  applause: () => {
    for (let i = 0; i < 18; i++) noise(i * 0.12, 0.2, 0.07, 'bandpass', 2200 + Math.random() * 1500, 1500);
  },
};
