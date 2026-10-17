// One set of controls for keyboard, gamepad and the touch pads. Scenes read `input.held.left` (held now) and
// `input.down.jump` (pressed this frame) — never the keyboard or a button directly — so every control drives the
// same moves. Add a control by adding its name to NAMES and its keys to KEYS.
export const NAMES = ['left', 'right', 'up', 'down', 'jump', 'action', 'pause', 'confirm'];
const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump', KeyX: 'action', KeyJ: 'action', ShiftLeft: 'action', Escape: 'pause', KeyP: 'pause', Enter: 'confirm',
};

export const input = { held: {}, down: {}, touch: false };
const sources = { keys: {}, pads: {}, gamepad: {} };
const prev = {};

/** Called once per frame (main.js hooks it to the game's step): merges the sources and works out what was just pressed. */
export function update() {
  const gp = navigator.getGamepads?.().find(Boolean);
  sources.gamepad = gp ? {
    left: gp.axes[0] < -0.4 || gp.buttons[14]?.pressed, right: gp.axes[0] > 0.4 || gp.buttons[15]?.pressed,
    up: gp.axes[1] < -0.5 || gp.buttons[12]?.pressed, down: gp.axes[1] > 0.5 || gp.buttons[13]?.pressed,
    jump: gp.buttons[0]?.pressed, action: gp.buttons[2]?.pressed || gp.buttons[1]?.pressed, pause: gp.buttons[9]?.pressed, confirm: gp.buttons[0]?.pressed,
  } : {};
  for (const n of NAMES) {
    const now = !!(sources.keys[n] || sources.pads[n] || sources.gamepad[n]);
    input.down[n] = now && !prev[n];
    input.held[n] = now;
    prev[n] = now;
  }
}

/** Hold a control for a moment, as a test or a demo would: `press('right', 300)`. */
export function press(name, ms = 120) {
  sources.keys[name] = true;
  setTimeout(() => { sources.keys[name] = false; }, ms);
}

/** Show the pads on a touch screen (or with ?touch=1), and wire keys and pads. `onLayout` when the pads appear. */
export function attach(onLayout = () => {}) {
  const showPads = () => {
    if (input.touch) return;
    input.touch = true;
    document.body.classList.add('touch');
    onLayout();
  };
  if (new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches) showPads();
  addEventListener('touchstart', showPads, { passive: true });
  addEventListener('keydown', e => {
    const n = KEYS[e.code];
    if (!n) return;
    sources.keys[n] = true;
    if (n === 'jump') sources.keys.confirm = true;
    e.preventDefault();
  });
  addEventListener('keyup', e => {
    const n = KEYS[e.code];
    if (!n) return;
    sources.keys[n] = false;
    if (n === 'jump') sources.keys.confirm = false;
  });
  addEventListener('blur', () => { for (const k of Object.keys(sources.keys)) sources.keys[k] = false; });
  for (const b of document.querySelectorAll('[data-key]')) {
    const n = b.dataset.key;
    const on = e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); sources.pads[n] = true; if (n === 'jump') sources.pads.confirm = true; b.classList.add('on'); };
    const off = () => { sources.pads[n] = false; if (n === 'jump') sources.pads.confirm = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
}
