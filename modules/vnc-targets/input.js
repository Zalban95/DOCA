'use strict';

/**
 * What the agent's vnc_input sends, as RFB events (rfb.act): a click, a double or right click, a move, a scroll, keys
 * ("ctrl+alt+Delete", "Enter", "F5") and text — X keysyms, with Shift held for the characters a US keyboard shifts,
 * since a server mapping keysyms to keys (QEMU's) types what the keys would.
 */
const NAMED = {
  enter: 0xff0d, return: 0xff0d, tab: 0xff09, escape: 0xff1b, esc: 0xff1b, backspace: 0xff08, delete: 0xffff, del: 0xffff,
  insert: 0xff63, home: 0xff50, end: 0xff57, pageup: 0xff55, pagedown: 0xff56, left: 0xff51, up: 0xff52, right: 0xff53, down: 0xff54,
  space: 0x20, shift: 0xffe1, ctrl: 0xffe3, control: 0xffe3, alt: 0xffe9, altgr: 0xfe03, super: 0xffeb, win: 0xffeb, windows: 0xffeb,
  meta: 0xffeb, cmd: 0xffeb, command: 0xffeb, menu: 0xff67, printscreen: 0xff61, print: 0xff61, capslock: 0xffe5,
};
const SHIFTED = /^[A-Z~!@#$%^&*()_+{}|:"<>?]$/;
const SHIFT = 0xffe1;

const charSym = c => { const n = c.codePointAt(0); return n === 10 ? 0xff0d : n === 9 ? 0xff09 : n < 0x100 ? n : 0x01000000 + n; };

/** A key's name, an F-key, or one character → its keysym; null when not known. */
function keysym(name) {
  const s = String(name || '');
  if ([...s].length === 1) return charSym(s);
  const k = s.toLowerCase().replace(/[\s_-]/g, '');
  if (NAMED[k] != null) return NAMED[k];
  const f = /^f([1-9]|1[0-2])$/.exec(k);
  return f ? 0xffbe + Number(f[1]) - 1 : null;
}

const press = (sym, shift) => (shift
  ? [{ key: SHIFT, down: true }, { key: sym, down: true }, { key: sym, down: false }, { key: SHIFT, down: false }]
  : [{ key: sym, down: true }, { key: sym, down: false }]);

/** Text, a character at a time. */
const typing = text => [...String(text)].flatMap(c => press(charSym(c), SHIFTED.test(c)));

/** "ctrl+shift+t": every key down in order, then up in reverse. Throws naming a key it does not know. */
function combo(keys) {
  const syms = String(keys).split('+').map(k => k.trim()).filter(Boolean).map(k => {
    const s = keysym(k);
    if (s == null) throw new Error(`"${k}" is not a key DOCA knows: name one like Enter, Tab, Escape, BackSpace, Delete, Up, F5, ctrl, alt, shift, super, or one character.`);
    return s;
  });
  if (!syms.length) throw new Error('Say which keys, like "Enter" or "ctrl+l".');
  return [...syms.map(key => ({ key, down: true })), ...syms.slice().reverse().map(key => ({ key, down: false }))];
}

const BUTTON = { left: 1, middle: 2, right: 4 };
const WHEEL = { up: 8, down: 16, left: 32, right: 64 };

/** Pointer events for a click (count 1 or 2) of `button` at x,y. */
const click = (x, y, button = 'left', count = 1) => [{ x, y, mask: 0 },
  ...Array.from({ length: count }, () => [{ x, y, mask: BUTTON[button] || 1 }, { x, y, mask: 0 }]).flat()];

/** A wheel turned `amount` notches at x,y. */
const scroll = (x, y, direction = 'down', amount = 3) => {
  const m = WHEEL[direction];
  if (!m) throw new Error('direction is up, down, left or right.');
  return [{ x, y, mask: 0 }, ...Array.from({ length: Math.max(1, Math.min(20, Math.round(amount) || 3)) }, () => [{ x, y, mask: m }, { x, y, mask: 0 }]).flat()];
};

module.exports = { keysym, typing, combo, click, scroll };
