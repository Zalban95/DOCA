/* ═══════════════════════════════════════════════════════
   The look: a style (the shape of things) beside the colour theme.

   A theme (themes.js) changes colours only. A style changes the shape: type,
   corners, spacing, capitals. Two of them:
     classic  the panel as it has been — mono, square, small capitals
     modern   lighter: a sans-serif UI, rounded, roomier, sentence case
              (css/skin-modern.css; code, logs and terminals stay mono)
   Kept in prefs as `skin`, and remembered in this browser too, so the page is
   drawn in the right style before prefs arrive.

   The light palette lives here as well — "Daylight", a theme like any other,
   and the natural pair for the modern style.
   ═══════════════════════════════════════════════════════ */

const SKINS = {
  classic: { label: 'Classic', note: 'Mono, square, compact' },
  modern:  { label: 'Modern',  note: 'Sans-serif, rounded, roomier' },
};

function lookApply(name) {
  const skin = SKINS[name] ? name : 'classic';
  document.documentElement.dataset.skin = skin;
  try { localStorage.setItem('doca.skin', skin); } catch { /* the pref still holds it */ }
  return skin;
}

THEMES.daylight = {
  label: 'Daylight',
  colors: {
    '--bg': '#f4f5f7', '--surface': '#ffffff', '--raised': '#f0f2f5',
    '--dim': '#eceef2', '--faint': '#d4d9e0',
    '--border': '#e3e6eb', '--border2': '#d3d8df',
    '--text': '#1f2430', '--muted': '#6b7483', '--bright': '#0b0e14',
    '--accent': '#c97a00', '--green': '#15894a', '--red': '#cc3434',
    '--blue': '#2d6cd6', '--purple': '#7550cc', '--teal': '#0f8f84', '--cyan': '#0a86a8',
    '--amber': '#c97a00',
    '--bg-green': '#e6f5ec', '--bg-red': '#fcebeb', '--bg-blue': '#e8effc', '--bg-amber': '#fbf1de',
    '--bg2': '#f0f2f5', '--bg3': '#e7eaee',
    '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
    '--text-muted': '#6b7483',
  },
  terminal: {
    background: '#ffffff', foreground: '#1f2430',
    cursor: '#2d6cd6', cursorAccent: '#ffffff',
    selectionBackground: 'rgba(45,108,214,0.18)',
    black: '#1f2430', red: '#cc3434', green: '#15894a', yellow: '#9a6700',
    blue: '#2d6cd6', magenta: '#7550cc', cyan: '#0a86a8', white: '#6b7483',
    brightBlack: '#4b5363', brightRed: '#e05050', brightGreen: '#1fa35a',
    brightYellow: '#b07c00', brightBlue: '#4a86ec', brightMagenta: '#9070e0',
    brightCyan: '#1aa0c4', brightWhite: '#9aa3b2',
  },
};

// Before anything is drawn: the style this browser last used.
try { lookApply(localStorage.getItem('doca.skin')); } catch { lookApply('classic'); }
