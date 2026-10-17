// Pictures drawn in code — no files to load. Each entry is a texture: its size and how to draw it on a Phaser
// Graphics. makeAll() draws every one at start (Boot); texture(scene, key) gives a stand-in for a name nobody has drawn
// yet, so an entity can use its key before the art lands. Keep one palette (PAL) so everything belongs together.
import { W, H, TILE } from '../config.js';

export const PAL = {
  night: 0x0b0f1a, sky: 0x1b2a4a, skyLow: 0x3a5a8a, hillFar: 0x23365c, hillNear: 0x2f4f6f,
  ground: 0x5b3a29, grass: 0x4caf50, stone: 0x6b7280, plat: 0x8d6e63, gold: 0xffd54f, red: 0xe53935,
  white: 0xffffff, ink: 0x101418, player: 0x4fc3f7, enemy: 0xab47bc, leaf: 0x81c784,
};

const band = (g, top, bottom, w, h, steps = 24) => {   // a vertical gradient as bands (works on Canvas and WebGL)
  const c1 = Phaser.Display.Color.ValueToColor(top), c2 = Phaser.Display.Color.ValueToColor(bottom);
  for (let i = 0; i < steps; i++) {
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(c1, c2, steps - 1, i);
    g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b)).fillRect(0, Math.floor(i * h / steps), w, Math.ceil(h / steps) + 1);
  }
};
const hills = (g, w, h, color, amp, base, seed) => {
  g.fillStyle(color).beginPath().moveTo(0, h);
  for (let x = 0; x <= w; x += 8) g.lineTo(x, base + Math.sin((x / w) * Math.PI * 2 * seed) * amp + Math.sin((x / w) * Math.PI * 6) * amp * 0.3);
  g.lineTo(w, h).closePath().fillPath();
};

export const ART = {
  player: { w: 28, h: 36, draw: g => {
    g.fillStyle(PAL.player).fillRoundedRect(2, 6, 24, 28, 6);
    g.fillStyle(PAL.white).fillCircle(10, 16, 4).fillCircle(19, 16, 4);
    g.fillStyle(PAL.ink).fillCircle(11, 16, 2).fillCircle(20, 16, 2);
    g.fillStyle(PAL.gold).fillTriangle(6, 8, 14, 0, 22, 8);
  } },
  ground: { w: TILE, h: TILE, draw: g => {
    g.fillStyle(PAL.ground).fillRect(0, 0, TILE, TILE);
    g.fillStyle(PAL.grass).fillRect(0, 0, TILE, 7);
    g.fillStyle(0x000000, 0.15).fillRect(4, 14, 6, 4).fillRect(20, 22, 7, 4);
  } },
  dirt: { w: TILE, h: TILE, draw: g => { g.fillStyle(PAL.ground).fillRect(0, 0, TILE, TILE); g.fillStyle(0x000000, 0.15).fillRect(6, 8, 6, 4).fillRect(18, 20, 7, 4); } },
  platform: { w: TILE, h: 12, draw: g => { g.fillStyle(PAL.plat).fillRoundedRect(0, 0, TILE, 12, 3); g.fillStyle(0xffffff, 0.2).fillRect(2, 2, TILE - 4, 2); } },
  spikes: { w: TILE, h: TILE, draw: g => { g.fillStyle(PAL.stone); for (let i = 0; i < 4; i++) g.fillTriangle(i * 8, TILE, i * 8 + 4, TILE - 16, i * 8 + 8, TILE); } },
  coin: { w: 18, h: 18, draw: g => { g.fillStyle(PAL.gold).fillCircle(9, 9, 8); g.fillStyle(0xffffff, 0.5).fillCircle(6, 6, 3); } },
  exit: { w: 32, h: 64, draw: g => { g.fillStyle(PAL.white).fillRect(4, 0, 4, 64); g.fillStyle(PAL.red).fillTriangle(8, 4, 30, 14, 8, 24); } },
  checkpoint: { w: 24, h: 48, draw: g => { g.fillStyle(PAL.stone).fillRect(10, 8, 4, 40); g.fillStyle(PAL.gold).fillCircle(12, 8, 7); } },
  heart: { w: 20, h: 18, draw: g => { g.fillStyle(PAL.red).fillCircle(6, 6, 5).fillCircle(14, 6, 5).fillTriangle(1, 8, 19, 8, 10, 18); } },
  slime: { w: 30, h: 22, draw: g => {
    g.fillStyle(PAL.enemy).fillEllipse(15, 13, 30, 20);
    g.fillStyle(PAL.white).fillCircle(10, 10, 3).fillCircle(20, 10, 3);
    g.fillStyle(PAL.ink).fillCircle(10, 11, 1.5).fillCircle(20, 11, 1.5);
  } },
  gem: { w: 20, h: 20, draw: g => { g.fillStyle(0x4dd0e1).fillTriangle(10, 0, 20, 8, 0, 8).fillTriangle(0, 8, 20, 8, 10, 20); g.fillStyle(0xffffff, 0.6).fillTriangle(10, 2, 14, 8, 6, 8); } },
  spark: { w: 8, h: 8, draw: g => g.fillStyle(PAL.white).fillCircle(4, 4, 4) },
  sky: { w: W, h: H, draw: (g, w, h) => band(g, PAL.night, PAL.skyLow, w, h) },
  'hills-far': { w: W, h: H, draw: (g, w, h) => hills(g, w, h, PAL.hillFar, 40, h * 0.62, 2) },
  'hills-near': { w: W, h: H, draw: (g, w, h) => hills(g, w, h, PAL.hillNear, 30, h * 0.78, 3) },
};

export function makeAll(scene) {
  for (const [key, a] of Object.entries(ART)) {
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({}, false);
    a.draw(g, a.w, a.h);
    g.generateTexture(key, a.w, a.h);
    g.destroy();
  }
}

/** The texture `key`, or — when nobody has drawn it yet — a labelled box of that size, so the game still runs. */
export function texture(scene, key, w = TILE, h = TILE) {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xff00ff, 0.8).fillRect(0, 0, w, h).lineStyle(2, 0xffffff).strokeRect(1, 1, w - 2, h - 2);
  g.generateTexture(key, w, h);
  g.destroy();
  console.warn(`art: no drawing for "${key}" yet — a stand-in is shown`);
  return key;
}
