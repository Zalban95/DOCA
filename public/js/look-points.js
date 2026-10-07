/* ═══════════════════════════════════════════════════════
   Points (wave E, TODO E1–E4; docs/audits/2026-10-06-design.md): a third style beside Classic and Modern, drawn
   with the face's own points, and its two palettes — Points (dark) and Points Daylight (light).

   The style is css/skin-points.css, scoped to html[data-skin="points"]: IBM Plex Sans for the interface, Plex Mono
   for labels and figures (capitals only for labels), 6 px corners on controls and 10 on cards, one accent, and every
   state a point of light (a sharp core and a soft glow, breathing only while something runs or asks).
   The palettes are themes like any other, so Points' colours work under Classic and Modern too.

   Which ground a theme has — light or dark — is marked on <html> as data-ground (themeMarkGround), so what must read
   differently on white (the chat button's disc, the face's background and its brightest ink: face/face.js) follows
   the theme without a palette of its own per theme.
   ═══════════════════════════════════════════════════════ */

SKINS.points = { label: 'Points', note: 'Plex Sans, calm, state as points of light' };

const _POINTS_TERMINAL = {
  background: '#050507', foreground: '#c9d1d9', cursor: '#57c9c2', cursorAccent: '#050507',
  selectionBackground: 'rgba(87,201,194,0.22)',
  black: '#26303a', red: '#e85050', green: '#5fcf8a', yellow: '#e8a020', blue: '#6f8aa3', magenta: '#a6bfd6',
  cyan: '#57c9c2', white: '#c9d1d9', brightBlack: '#5b6570', brightRed: '#f07a7a', brightGreen: '#86e0a8',
  brightYellow: '#f0bb5a', brightBlue: '#94adc4', brightMagenta: '#c4d6e6', brightCyan: '#8fe0da', brightWhite: '#e8edf2',
};

THEMES.points = {
  label: 'Points',
  colors: {
    '--bg': '#050507', '--surface': '#0b0d10', '--raised': '#11151a',
    '--dim': '#0e1115', '--faint': '#26303a',
    '--border': '#1c2229', '--border2': '#26303a',
    '--text': '#c9d1d9', '--muted': '#8b95a1', '--bright': '#e8edf2',
    '--accent': '#57c9c2', '--green': '#5fcf8a', '--red': '#e85050',
    '--blue': '#6f8aa3', '--purple': '#a6bfd6', '--teal': '#57c9c2', '--cyan': '#a6bfd6',
    '--amber': '#e8a020',
    '--bg-green': '#0b1a12', '--bg-red': '#140909', '--bg-blue': '#0c1218', '--bg-amber': '#140e05',
    '--bg2': '#08090c', '--bg3': '#11151a',
    '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
    '--text-muted': '#8b95a1',
    '--on-accent': '#050507', '--stopped': '#3a434d', '--field': '#a6bfd6',
  },
  terminal: _POINTS_TERMINAL,
};

THEMES.pointsDaylight = {
  label: 'Points Daylight',
  colors: {
    '--bg': '#f4f5f6', '--surface': '#ffffff', '--raised': '#f7f8f9',
    '--dim': '#ffffff', '--faint': '#dde2e7',
    '--border': '#e3e7eb', '--border2': '#cdd4db',
    '--text': '#2a3138', '--muted': '#5b6570', '--bright': '#14181c',
    '--accent': '#17807a', '--green': '#2f9e5b', '--red': '#c23d3d',
    '--blue': '#4a6a88', '--purple': '#5b6f99', '--teal': '#17807a', '--cyan': '#2b7a99',
    '--amber': '#a86a00',
    '--bg-green': '#e7f4ec', '--bg-red': '#fbeaea', '--bg-blue': '#eaf0f6', '--bg-amber': '#fbf1de',
    '--bg2': '#fafbfb', '--bg3': '#eef1f3',
    '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
    '--text-muted': '#5b6570',
    '--on-accent': '#ffffff', '--stopped': '#b9c1c9', '--field': '#4a6a88',
  },
  terminal: {
    background: '#ffffff', foreground: '#2a3138', cursor: '#17807a', cursorAccent: '#ffffff',
    selectionBackground: 'rgba(23,128,122,0.16)',
    black: '#14181c', red: '#c23d3d', green: '#2f9e5b', yellow: '#a86a00', blue: '#4a6a88', magenta: '#5b6f99',
    cyan: '#17807a', white: '#5b6570', brightBlack: '#3a434d', brightRed: '#d65454', brightGreen: '#3cb26c',
    brightYellow: '#c08000', brightBlue: '#5f82a3', brightMagenta: '#7286b0', brightCyan: '#1f9a93', brightWhite: '#8b95a1',
  },
};

/** Light or dark, from a colour's luminance: a custom theme is judged by its own ground. */
function themeGroundOf(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bg || '').trim());
  if (!m) return 'dark';
  const v = parseInt(m[1], 16), lum = (0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
  return lum > 0.5 ? 'light' : 'dark';
}

/** Mark <html> with the ground of the theme in use; a change redraws the corner face in its new colours. */
function themeMarkGround() {
  const root = document.documentElement;
  const bg = root.style.getPropertyValue('--bg') || getComputedStyle(root).getPropertyValue('--bg');
  const ground = themeGroundOf(bg);
  const was = root.dataset.ground;
  root.dataset.ground = ground;
  try { localStorage.setItem('doca.theme', _currentTheme === 'custom' ? '' : _currentTheme); } catch { /* the pref holds it */ }
  if (was && was !== ground && typeof faceCornerReload === 'function' && document.getElementById('face-corner')) faceCornerReload();
}

/** Choosing the Points style with a palette that is not its own also chooses Points' dark palette (the two were
 *  designed together); any palette can still be picked under it afterwards. */
function lookPointsPalette(skin) {
  if (skin !== 'points' || String(_currentTheme).startsWith('points')) return null;
  return 'points';
}

// Before anything is drawn: the palette this browser last used, so a Points screen does not flash Classic's colours.
try {
  const t = localStorage.getItem('doca.theme');
  if (t && t !== 'default' && THEMES[t]) applyTheme(t); else themeMarkGround();
} catch { /* no storage: prefs apply the theme a moment later */ }
