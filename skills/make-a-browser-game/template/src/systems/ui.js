// Menus that work with a tap, a mouse, the arrow keys and a gamepad alike. menu(scene, items) draws a column of buttons
// and moves a highlight with up/down; confirm (Enter, Space, A) or a tap runs one. Big targets: a thumb is wide.
import { input } from './input.js';
import { play } from './audio.js';
import { W } from '../config.js';

export const FONT = 'system-ui, sans-serif';
export const text = (scene, x, y, s, size = 28, color = '#ffffff') =>
  scene.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color, align: 'center', stroke: '#000000', strokeThickness: Math.max(2, size / 8) }).setOrigin(0.5);

export function button(scene, x, y, label, onPick, { w = 300, h = 60, size = 28 } = {}) {
  const box = scene.add.rectangle(x, y, w, h, 0xffffff, 0.08).setStrokeStyle(2, 0xffffff, 0.4).setInteractive({ useHandCursor: true });
  const t = text(scene, x, y, label, size);
  const b = { box, t, onPick, focus(on) { box.setFillStyle(0xffffff, on ? 0.25 : 0.08); box.setStrokeStyle(2, 0xffffff, on ? 0.9 : 0.4); } };
  box.on('pointerup', () => { play('select'); onPick(); });
  return b;
}

/** A column of buttons, centred at y, driven by input too. Returns its update(), to call from the scene's update. */
export function menu(scene, items, { y = 260, gap = 76, x = W / 2 } = {}) {
  const buttons = items.map((it, i) => button(scene, x, y + i * gap, it.label, it.pick));
  let at = 0;
  const show = () => buttons.forEach((b, i) => b.focus(i === at));
  buttons.forEach((b, i) => b.box.on('pointerover', () => { at = i; show(); }));
  show();
  return () => {
    if (input.down.up || input.down.left) { at = (at + buttons.length - 1) % buttons.length; play('select'); show(); }
    if (input.down.down || input.down.right) { at = (at + 1) % buttons.length; play('select'); show(); }
    if (input.down.confirm || input.down.jump) { play('select'); buttons[at].onPick(); }
  };
}
