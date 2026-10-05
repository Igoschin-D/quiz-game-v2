import { audioCtx, isMuted, onMuteChange, onUnlock } from './sound';

/**
 * Background music: every stage of the game has its own track.
 * "lobby" and "final" are audio files (from the first version of the game), all others are synthesized here,
 * so the game stays original and needs no extra downloads.
 */
export type TrackId = 'lobby' | 'intro' | 'category' | 'mutator' | 'powerups' | 'question' | 'running' | 'results' | 'next' | 'final';

const FILES: Partial<Record<TrackId, string>> = { lobby: '/music/bg.mp3', final: '/music/final.mp3' };

interface SynthDef {
  bpm: number;
  /** MIDI note of the key root (chord roots are offsets from it). */
  root: number;
  minor: boolean;
  /** One chord root (semitones above `root`) per bar. */
  prog: number[];
  /** 16 steps. Bass: semitone offset from the chord root (two octaves down). */
  bass: (number | null)[];
  /** 16 steps. Arp: index into the chord tones [root, third, fifth, root+12, third+12, fifth+12]. */
  arp: (number | null)[];
  kick: number[];
  snare: number[];
  hat: number[];
  pad?: boolean;
  /** Snare roll on the last beat of every 4th bar. */
  fill?: boolean;
  bassWave?: OscillatorType;
  arpWave?: OscillatorType;
  /** Relative loudness of the whole track. */
  level: number;
}

const N = null;
const SYNTH: Partial<Record<TrackId, SynthDef>> = {
  intro: {
    bpm: 112, root: 48, minor: false, prog: [0, 5, 7, 5],
    bass: [0, N, N, 0, N, N, 7, N, 0, N, N, 0, N, N, 7, N],
    arp: [0, 1, 2, 3, 2, 1, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
    kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], pad: true, level: 0.9,
  },
  category: {
    bpm: 132, root: 50, minor: false, prog: [0, 7, 5, 7],
    bass: [0, N, 0, N, 7, N, 7, N, 0, N, 0, N, 5, N, 7, N],
    arp: [0, 2, 1, 2, 0, 2, 1, 2, 3, 2, 1, 2, 3, 5, 4, 2],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], arpWave: 'square', level: 0.7, fill: true,
  },
  mutator: {
    bpm: 92, root: 52, minor: true, prog: [0, 0, 8, 7],
    bass: [0, N, N, N, N, N, N, N, 0, N, N, N, 7, N, N, N],
    arp: [4, N, N, N, 5, N, N, N, 4, N, N, N, 2, N, N, N],
    kick: [0, 10], snare: [12], hat: [], pad: true, bassWave: 'sawtooth', level: 0.9,
  },
  powerups: {
    bpm: 116, root: 54, minor: true, prog: [0, 0, 3, 5],
    bass: [0, N, 7, N, 0, N, 5, N, 0, N, 7, N, 3, N, 5, N],
    arp: [N, 2, N, 2, N, N, 4, N, N, 2, N, 2, N, N, 5, N],
    kick: [0, 10], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14], level: 0.85,
  },
  question: {
    bpm: 124, root: 45, minor: true, prog: [0, 0, 5, 7],
    bass: [0, N, 0, N, 0, N, 0, N, 0, N, 0, N, 0, N, 0, N],
    arp: [N, N, N, N, 2, N, N, N, N, N, N, N, 4, N, N, N],
    kick: [0, 8], snare: [], hat: [2, 6, 10, 14], bassWave: 'triangle', level: 0.8,
  },
  running: {
    bpm: 148, root: 45, minor: true, prog: [0, 0, 0, 7],
    bass: [0, 0, N, 0, 0, N, 0, 0, 0, 0, N, 0, 0, N, 7, N],
    arp: [0, 2, 0, 2, 0, 2, 0, 2, 3, 5, 3, 5, 3, 5, 3, 5],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fill: true, arpWave: 'sawtooth', bassWave: 'sawtooth', level: 0.85,
  },
  results: {
    bpm: 120, root: 55, minor: false, prog: [0, 5, 7, 0],
    bass: [0, N, N, 0, N, 0, N, N, 0, N, N, 0, N, 0, N, N],
    arp: [2, 3, 4, 3, 2, 3, 4, 5, 2, 3, 4, 3, 5, 4, 3, 2],
    kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], pad: true, level: 0.9,
  },
  next: {
    bpm: 98, root: 48, minor: true, prog: [0, 8, 3, 7],
    bass: [0, N, N, N, N, N, 7, N, 0, N, N, N, N, N, 7, N],
    arp: [0, N, 1, N, 2, N, 1, N, 0, N, 1, N, 2, N, 4, N],
    kick: [0, 8], snare: [12], hat: [4, 12], pad: true, arpWave: 'sine', level: 0.8,
  },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(ctx: BaseAudioContext) {
  if (noiseBuf && noiseBuf.sampleRate !== ctx.sampleRate) noiseBuf = null;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Step sequencer with a look-ahead scheduler (16 steps per bar). */
class Sequencer {
  readonly gain: GainNode;
  private timer: number | null = null;
  private step = 0;
  private next = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly def: SynthDef,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(ctx.destination);
  }

  start() {
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.tick(), 80);
  }

  /** Offline rendering (previews / tests): schedules `seconds` of the track at once at full volume. */
  renderAll(seconds: number) {
    this.gain.gain.value = 1;
    const stepLen = 60 / this.def.bpm / 4;
    for (let step = 0, t = 0; t < seconds; step++, t += stepLen) this.schedule(step, t);
  }

  fadeTo(value: number, seconds: number) {
    this.gain.gain.setTargetAtTime(value, this.ctx.currentTime, Math.max(0.05, seconds / 3));
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    try {
      this.gain.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private tick() {
    if (this.ctx.state !== 'running') {
      this.next = Math.max(this.next, this.ctx.currentTime + 0.05);
      return;
    }
    const stepLen = 60 / this.def.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.35) {
      this.schedule(this.step, this.next);
      this.next += stepLen;
      this.step++;
    }
  }

  private schedule(step: number, t: number) {
    const d = this.def;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = d.root + d.prog[bar % d.prog.length];
    const third = d.minor ? 3 : 4;
    const tones = [0, third, 7, 12, third + 12, 19];
    const stepLen = 60 / d.bpm / 4;

    const bass = d.bass[s];
    if (bass !== null && bass !== undefined) this.voice(midi(chord + bass - 24), t, stepLen * 1.8, d.bassWave ?? 'triangle', 0.32);
    const arp = d.arp[s];
    if (arp !== null && arp !== undefined) this.voice(midi(chord + tones[arp] + 12), t, stepLen * 1.4, d.arpWave ?? 'triangle', 0.1);
    if (d.pad && s === 0) for (const tone of tones.slice(0, 3)) this.voice(midi(chord + tone), t, stepLen * 15, 'triangle', 0.05, 0.4);

    if (d.kick.includes(s)) this.kick(t);
    const roll = d.fill && bar % 4 === 3 && s >= 12;
    if (d.snare.includes(s) || roll) this.snare(t, roll ? 0.12 : 0.2);
    if (d.hat.includes(s)) this.hat(t);
  }

  private voice(freq: number, t: number, dur: number, type: OscillatorType, vol: number, attack = 0.01) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * this.def.level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.gain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.55 * this.def.level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(g).connect(this.gain);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  private noise(t: number, dur: number, vol: number, freq: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * this.def.level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.gain);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  private snare(t: number, vol: number) {
    this.noise(t, 0.12, vol, 1800);
  }

  private hat(t: number) {
    this.noise(t, 0.04, 0.07, 7000);
  }
}

let wanted: { track: TrackId | null; volume: number } = { track: null, volume: 0 };
const files = new Map<TrackId, HTMLAudioElement>();
const fileTarget = new Map<TrackId, number>();
const seqs = new Map<TrackId, Sequencer>();
let fader: number | null = null;

function fileEl(id: TrackId) {
  let a = files.get(id);
  if (!a) {
    a = new Audio(FILES[id]);
    a.loop = id === 'lobby';
    a.preload = 'auto';
    a.volume = 0;
    files.set(id, a);
  }
  return a;
}

function stepFiles() {
  let busy = false;
  for (const [id, a] of files) {
    const goal = fileTarget.get(id) ?? 0;
    const diff = goal - a.volume;
    if (Math.abs(diff) > 0.005) {
      a.volume = Math.min(1, Math.max(0, a.volume + Math.sign(diff) * Math.min(Math.abs(diff), 0.03)));
      busy = true;
    } else {
      a.volume = goal;
      if (goal === 0 && !a.paused) a.pause();
    }
  }
  if (!busy && fader !== null) {
    clearInterval(fader);
    fader = null;
  }
}

function apply() {
  const silent = isMuted();
  // files
  for (const id of Object.keys(FILES) as TrackId[]) {
    const on = !silent && wanted.track === id;
    fileTarget.set(id, on ? wanted.volume : 0);
    if (on) {
      const a = fileEl(id);
      if (a.paused) void a.play().catch(() => undefined); // blocked until the first click: retried on unlock
    }
  }
  if (files.size) fader ??= window.setInterval(stepFiles, 50);

  // synthesized tracks
  const ctx = silent ? null : audioCtx();
  for (const [id, seq] of [...seqs]) {
    if (id !== wanted.track || silent) {
      seq.fadeTo(0, 1.2);
      seqs.delete(id);
      window.setTimeout(() => seq.stop(), 2200);
    }
  }
  const def = wanted.track ? SYNTH[wanted.track] : undefined;
  if (ctx && wanted.track && def) {
    let seq = seqs.get(wanted.track);
    if (!seq) {
      seq = new Sequencer(ctx, def);
      seqs.set(wanted.track, seq);
      seq.start();
    }
    seq.fadeTo(wanted.volume * 2, 1);
  }
}

export const music = {
  /** Switches to a stage track with a cross-fade. `volume` 0..1; no track = silence. */
  play(track: TrackId | null, volume = 0.3) {
    if (wanted.track === track && wanted.volume === volume) return;
    wanted = { track, volume };
    apply();
  },
  stop() {
    this.play(null, 0);
  },
};

onUnlock(() => {
  if (wanted.track) apply();
});
onMuteChange(() => apply());

/** Renders a synthesized track to a mono buffer (used by e2e/render-music.mjs to preview and check levels). */
export async function renderTrackPreview(id: TrackId, seconds: number, sampleRate = 32000): Promise<number[]> {
  const def = SYNTH[id];
  if (!def) throw new Error(`${id} is not a synthesized track`);
  const offline = new OfflineAudioContext(1, Math.floor(seconds * sampleRate), sampleRate);
  new Sequencer(offline, def).renderAll(seconds);
  const buf = await offline.startRendering();
  return Array.from(buf.getChannelData(0));
}

(window as unknown as { __zsaRenderTrack: typeof renderTrackPreview }).__zsaRenderTrack = renderTrackPreview;
