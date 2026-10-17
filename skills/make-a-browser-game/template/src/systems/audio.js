// Sound made in the browser — no files to load. play('jump') for an effect, music('world1') for a loop, music(null) to
// stop. Add an effect to SFX and a tune to TUNES; an unknown name plays a short blip, so a missing sound never breaks.
import { load } from './save.js';

let ctx = null, master = null, musicGain = null, timer = null;

/** Make the audio context on the first press (browsers allow sound only after one). */
export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = load().settings.volume;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.35;
  musicGain.connect(master);
}
if (typeof window !== 'undefined') { addEventListener('pointerdown', unlock); addEventListener('keydown', unlock); }

// One tone: wave, start and end pitch (Hz), length (s), loudness. An effect is a list of tones, each after `at` seconds.
const SFX = {
  jump: [{ wave: 'square', from: 320, to: 640, dur: 0.12, vol: 0.25 }],
  coin: [{ wave: 'square', from: 990, to: 990, dur: 0.06, vol: 0.2 }, { at: 0.06, wave: 'square', from: 1320, to: 1320, dur: 0.12, vol: 0.2 }],
  hit: [{ wave: 'sawtooth', from: 300, to: 60, dur: 0.25, vol: 0.3 }],
  stomp: [{ wave: 'triangle', from: 500, to: 120, dur: 0.12, vol: 0.35 }],
  powerup: [0, 0.07, 0.14, 0.21].map((at, i) => ({ at, wave: 'square', from: 520 * (1 + i / 4), to: 520 * (1 + i / 4), dur: 0.07, vol: 0.2 })),
  checkpoint: [{ wave: 'triangle', from: 660, to: 880, dur: 0.2, vol: 0.25 }],
  win: [0, 0.12, 0.24, 0.36].map((at, i) => ({ at, wave: 'triangle', from: [523, 659, 784, 1046][i], to: [523, 659, 784, 1046][i], dur: 0.16, vol: 0.3 })),
  lose: [0, 0.18, 0.36].map((at, i) => ({ at, wave: 'triangle', from: [392, 330, 262][i], to: [392, 330, 262][i], dur: 0.22, vol: 0.3 })),
  select: [{ wave: 'square', from: 660, to: 660, dur: 0.05, vol: 0.15 }],
  blip: [{ wave: 'square', from: 440, to: 440, dur: 0.05, vol: 0.12 }],
};

function tone({ at = 0, wave, from, to, dur, vol }, out = master) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function play(name) {
  if (!ctx || !load().settings.sfx) return;
  for (const t of SFX[name] || SFX.blip) tone(t);
}

// A tune: tempo (beats a minute) and voices of notes, one per eighth note: a note name ("C4", "A#3") or "-" for a rest.
const TUNES = {
  menu: { bpm: 100, voices: [
    { wave: 'triangle', vol: 0.2, notes: 'C4 - E4 - G4 - E4 - A3 - C4 - E4 - C4 -'.split(' ') },
    { wave: 'sine', vol: 0.25, notes: 'C3 - - - A2 - - - F2 - - - G2 - - -'.split(' ') }] },
  world1: { bpm: 132, voices: [
    { wave: 'square', vol: 0.12, notes: 'E4 G4 A4 - G4 E4 D4 - C4 D4 E4 G4 E4 - - -'.split(' ') },
    { wave: 'triangle', vol: 0.22, notes: 'C3 - G2 - A2 - E2 - F2 - C3 - G2 - G2 -'.split(' ') }] },
};
const PITCH = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const hz = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return m ? 440 * 2 ** ((PITCH[m[1]] + 12 * (Number(m[2]) + 1) - 69) / 12) : 0; };

export function music(name) {
  clearInterval(timer);
  timer = null;
  const tune = TUNES[name];
  if (!tune || !ctx || !load().settings.music) return;
  const step = 60 / tune.bpm / 2;
  let i = 0;
  const tick = () => {
    for (const v of tune.voices) {
      const f = hz(v.notes[i % v.notes.length]);
      if (f) tone({ wave: v.wave, from: f, to: f, dur: step * 0.9, vol: v.vol }, musicGain);
    }
    i++;
  };
  tick();
  timer = setInterval(tick, step * 1000);
}

export function setVolume(v) { if (master) master.gain.value = v; }
export const names = () => ({ sfx: Object.keys(SFX), tunes: Object.keys(TUNES) });
