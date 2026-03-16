/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — COLOR THEMES
   ═══════════════════════════════════════════════════════ */

let _currentTheme = 'default';
let _customThemeColors = {};

const THEME_CSS_KEYS = [
  '--bg', '--surface', '--raised', '--dim', '--faint',
  '--border', '--border2',
  '--text', '--muted', '--bright',
  '--accent', '--green', '--red', '--blue', '--purple', '--teal', '--cyan', '--amber',
  '--bg-green', '--bg-red', '--bg-blue', '--bg-amber',
  '--bg2', '--bg3', '--font-mono', '--text-muted',
];

const THEME_CUSTOM_EDITOR_KEYS = [
  { key: '--bg',      label: 'Background' },
  { key: '--surface', label: 'Surface' },
  { key: '--raised',  label: 'Raised' },
  { key: '--dim',     label: 'Dim' },
  { key: '--border',  label: 'Border' },
  { key: '--text',    label: 'Text' },
  { key: '--muted',   label: 'Muted' },
  { key: '--bright',  label: 'Bright' },
  { key: '--accent',  label: 'Accent' },
  { key: '--green',   label: 'Green' },
  { key: '--red',     label: 'Red' },
  { key: '--blue',    label: 'Blue' },
  { key: '--purple',  label: 'Purple' },
  { key: '--teal',    label: 'Teal' },
  { key: '--cyan',    label: 'Cyan' },
];

const THEMES = {

  default: {
    label: 'Default',
    colors: {
      '--bg': '#090b0d', '--surface': '#0f1214', '--raised': '#141719',
      '--dim': '#1a1d20', '--faint': '#2a3038',
      '--border': '#1e2226', '--border2': '#272d33',
      '--text': '#c0cad4', '--muted': '#505c68', '--bright': '#ffffff',
      '--accent': '#e8a020', '--green': '#3ecf74', '--red': '#e85050',
      '--blue': '#4a9de8', '--purple': '#a078e8', '--teal': '#30c8b8', '--cyan': '#28b8d8',
      '--amber': '#e8a020',
      '--bg-green': '#0e2016', '--bg-red': '#200e0e', '--bg-blue': '#0c1a28', '--bg-amber': '#201408',
      '--bg2': '#0c0e10', '--bg3': '#181c20',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#505c68',
    },
    terminal: {
      background: '#0d1117', foreground: '#c9d1d9',
      cursor: '#58a6ff', cursorAccent: '#0d1117',
      selectionBackground: 'rgba(88,166,255,0.25)',
      black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
      brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
    },
  },

  dracula: {
    label: 'Dracula',
    colors: {
      '--bg': '#1e1f29', '--surface': '#282a36', '--raised': '#2c2e3a',
      '--dim': '#343746', '--faint': '#44475a',
      '--border': '#393c4e', '--border2': '#44475a',
      '--text': '#f8f8f2', '--muted': '#6272a4', '--bright': '#ffffff',
      '--accent': '#bd93f9', '--green': '#50fa7b', '--red': '#ff5555',
      '--blue': '#8be9fd', '--purple': '#bd93f9', '--teal': '#8be9fd', '--cyan': '#8be9fd',
      '--amber': '#f1fa8c',
      '--bg-green': '#1a2e1e', '--bg-red': '#2e1a1a', '--bg-blue': '#1a2438', '--bg-amber': '#2e2a14',
      '--bg2': '#21222c', '--bg3': '#313245',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#6272a4',
    },
    terminal: {
      background: '#282a36', foreground: '#f8f8f2',
      cursor: '#f8f8f2', cursorAccent: '#282a36',
      selectionBackground: 'rgba(68,71,90,0.5)',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
      brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
  },

  nord: {
    label: 'Nord',
    colors: {
      '--bg': '#242933', '--surface': '#2e3440', '--raised': '#3b4252',
      '--dim': '#434c5e', '--faint': '#4c566a',
      '--border': '#3b4252', '--border2': '#4c566a',
      '--text': '#d8dee9', '--muted': '#616e88', '--bright': '#eceff4',
      '--accent': '#88c0d0', '--green': '#a3be8c', '--red': '#bf616a',
      '--blue': '#81a1c1', '--purple': '#b48ead', '--teal': '#8fbcbb', '--cyan': '#88c0d0',
      '--amber': '#ebcb8b',
      '--bg-green': '#2a3325', '--bg-red': '#3b2a2a', '--bg-blue': '#2a3040', '--bg-amber': '#3b3525',
      '--bg2': '#272d38', '--bg3': '#353d4a',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#616e88',
    },
    terminal: {
      background: '#2e3440', foreground: '#d8dee9',
      cursor: '#d8dee9', cursorAccent: '#2e3440',
      selectionBackground: 'rgba(136,192,208,0.2)',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
  },

  solarized: {
    label: 'Solarized Dark',
    colors: {
      '--bg': '#00212b', '--surface': '#002b36', '--raised': '#073642',
      '--dim': '#0a3e4c', '--faint': '#1a4e5c',
      '--border': '#0a3e4c', '--border2': '#1a4e5c',
      '--text': '#839496', '--muted': '#586e75', '--bright': '#fdf6e3',
      '--accent': '#2aa198', '--green': '#859900', '--red': '#dc322f',
      '--blue': '#268bd2', '--purple': '#6c71c4', '--teal': '#2aa198', '--cyan': '#2aa198',
      '--amber': '#b58900',
      '--bg-green': '#0a2a10', '--bg-red': '#2a0a0a', '--bg-blue': '#0a1a2a', '--bg-amber': '#2a2008',
      '--bg2': '#001e28', '--bg3': '#0a3642',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#586e75',
    },
    terminal: {
      background: '#002b36', foreground: '#839496',
      cursor: '#839496', cursorAccent: '#002b36',
      selectionBackground: 'rgba(42,161,152,0.2)',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75',
      brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  },

  monokai: {
    label: 'Monokai',
    colors: {
      '--bg': '#1e1f1c', '--surface': '#272822', '--raised': '#2e2f2a',
      '--dim': '#3e3d32', '--faint': '#49483e',
      '--border': '#3e3d32', '--border2': '#49483e',
      '--text': '#f8f8f2', '--muted': '#75715e', '--bright': '#ffffff',
      '--accent': '#a6e22e', '--green': '#a6e22e', '--red': '#f92672',
      '--blue': '#66d9ef', '--purple': '#ae81ff', '--teal': '#66d9ef', '--cyan': '#66d9ef',
      '--amber': '#e6db74',
      '--bg-green': '#1e2a14', '--bg-red': '#2e141e', '--bg-blue': '#142430', '--bg-amber': '#2e2a14',
      '--bg2': '#222318', '--bg3': '#383830',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#75715e',
    },
    terminal: {
      background: '#272822', foreground: '#f8f8f2',
      cursor: '#f8f8f0', cursorAccent: '#272822',
      selectionBackground: 'rgba(166,226,46,0.2)',
      black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
      blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
      brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e',
      brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
    },
  },

  catppuccin: {
    label: 'Catppuccin Mocha',
    colors: {
      '--bg': '#181825', '--surface': '#1e1e2e', '--raised': '#262637',
      '--dim': '#313244', '--faint': '#45475a',
      '--border': '#313244', '--border2': '#45475a',
      '--text': '#cdd6f4', '--muted': '#6c7086', '--bright': '#ffffff',
      '--accent': '#cba6f7', '--green': '#a6e3a1', '--red': '#f38ba8',
      '--blue': '#89b4fa', '--purple': '#cba6f7', '--teal': '#94e2d5', '--cyan': '#89dceb',
      '--amber': '#f9e2af',
      '--bg-green': '#1a2e20', '--bg-red': '#2e1a22', '--bg-blue': '#1a2240', '--bg-amber': '#2e2a18',
      '--bg2': '#16161e', '--bg3': '#2a2a3c',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#6c7086',
    },
    terminal: {
      background: '#1e1e2e', foreground: '#cdd6f4',
      cursor: '#f5e0dc', cursorAccent: '#1e1e2e',
      selectionBackground: 'rgba(203,166,247,0.2)',
      black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
      blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
      brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5', brightWhite: '#a6adc8',
    },
  },

  gruvbox: {
    label: 'Gruvbox Dark',
    colors: {
      '--bg': '#1d2021', '--surface': '#282828', '--raised': '#32302f',
      '--dim': '#3c3836', '--faint': '#504945',
      '--border': '#3c3836', '--border2': '#504945',
      '--text': '#ebdbb2', '--muted': '#928374', '--bright': '#fbf1c7',
      '--accent': '#fe8019', '--green': '#b8bb26', '--red': '#fb4934',
      '--blue': '#83a598', '--purple': '#d3869b', '--teal': '#8ec07c', '--cyan': '#83a598',
      '--amber': '#fabd2f',
      '--bg-green': '#2a2e18', '--bg-red': '#2e1a16', '--bg-blue': '#1a2830', '--bg-amber': '#2e2816',
      '--bg2': '#1a1c1d', '--bg3': '#3a3634',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#928374',
    },
    terminal: {
      background: '#282828', foreground: '#ebdbb2',
      cursor: '#ebdbb2', cursorAccent: '#282828',
      selectionBackground: 'rgba(254,128,25,0.2)',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
      blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26',
      brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b',
      brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
    },
  },

  tokyoNight: {
    label: 'Tokyo Night',
    colors: {
      '--bg': '#16161e', '--surface': '#1a1b26', '--raised': '#24283b',
      '--dim': '#292e42', '--faint': '#3b4261',
      '--border': '#292e42', '--border2': '#3b4261',
      '--text': '#a9b1d6', '--muted': '#565f89', '--bright': '#c0caf5',
      '--accent': '#7aa2f7', '--green': '#9ece6a', '--red': '#f7768e',
      '--blue': '#7aa2f7', '--purple': '#bb9af7', '--teal': '#73daca', '--cyan': '#7dcfff',
      '--amber': '#e0af68',
      '--bg-green': '#1a2e1e', '--bg-red': '#2e1a20', '--bg-blue': '#1a2040', '--bg-amber': '#2e2818',
      '--bg2': '#13131a', '--bg3': '#20223a',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#565f89',
    },
    terminal: {
      background: '#1a1b26', foreground: '#a9b1d6',
      cursor: '#c0caf5', cursorAccent: '#1a1b26',
      selectionBackground: 'rgba(122,162,247,0.2)',
      black: '#414868', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
      blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
      brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a',
      brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff', brightWhite: '#c0caf5',
    },
  },

  oneDark: {
    label: 'One Dark',
    colors: {
      '--bg': '#21252b', '--surface': '#282c34', '--raised': '#2c313a',
      '--dim': '#353b45', '--faint': '#3e4451',
      '--border': '#353b45', '--border2': '#3e4451',
      '--text': '#abb2bf', '--muted': '#5c6370', '--bright': '#ffffff',
      '--accent': '#61afef', '--green': '#98c379', '--red': '#e06c75',
      '--blue': '#61afef', '--purple': '#c678dd', '--teal': '#56b6c2', '--cyan': '#56b6c2',
      '--amber': '#e5c07b',
      '--bg-green': '#1e2e1e', '--bg-red': '#2e1e1e', '--bg-blue': '#1e2438', '--bg-amber': '#2e2a18',
      '--bg2': '#1e2228', '--bg3': '#303640',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#5c6370',
    },
    terminal: {
      background: '#282c34', foreground: '#abb2bf',
      cursor: '#528bff', cursorAccent: '#282c34',
      selectionBackground: 'rgba(97,175,239,0.2)',
      black: '#3f4451', red: '#e06c75', green: '#98c379', yellow: '#d19a66',
      blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#4f5666', brightRed: '#be5046', brightGreen: '#98c379',
      brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
      brightCyan: '#56b6c2', brightWhite: '#d7dae0',
    },
  },

  cyberpunk: {
    label: 'Cyberpunk',
    colors: {
      '--bg': '#0a0a0f', '--surface': '#0e0e18', '--raised': '#141422',
      '--dim': '#1a1a2e', '--faint': '#252540',
      '--border': '#1e1e35', '--border2': '#2a2a48',
      '--text': '#c8d0e0', '--muted': '#505878', '--bright': '#f0f0ff',
      '--accent': '#00ff9f', '--green': '#00ff9f', '--red': '#ff2a6d',
      '--blue': '#05d9e8', '--purple': '#d16bff', '--teal': '#00ff9f', '--cyan': '#05d9e8',
      '--amber': '#f0e800',
      '--bg-green': '#0a1e14', '--bg-red': '#1e0a14', '--bg-blue': '#0a1420', '--bg-amber': '#1e1c08',
      '--bg2': '#08080c', '--bg3': '#18182a',
      '--font-mono': '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
      '--text-muted': '#505878',
    },
    terminal: {
      background: '#0e0e18', foreground: '#c8d0e0',
      cursor: '#00ff9f', cursorAccent: '#0e0e18',
      selectionBackground: 'rgba(0,255,159,0.15)',
      black: '#1a1a2e', red: '#ff2a6d', green: '#00ff9f', yellow: '#f0e800',
      blue: '#05d9e8', magenta: '#d16bff', cyan: '#05d9e8', white: '#c8d0e0',
      brightBlack: '#3a3a5e', brightRed: '#ff5c8d', brightGreen: '#33ffb2',
      brightYellow: '#f5f060', brightBlue: '#40e8f0', brightMagenta: '#dc8fff',
      brightCyan: '#40e8f0', brightWhite: '#f0f0ff',
    },
  },
};

/* ── Apply a named preset ──────────────────────────────── */

function applyTheme(name) {
  const theme = THEMES[name];
  if (!theme) return;
  _currentTheme = name;
  const root = document.documentElement;
  for (const [prop, val] of Object.entries(theme.colors)) {
    root.style.setProperty(prop, val);
  }
  _applyTerminalThemes();
}

/* ── Apply custom overrides ────────────────────────────── */

function applyCustomTheme(overrides) {
  _currentTheme = 'custom';
  _customThemeColors = { ...THEMES.default.colors, ...overrides };
  const root = document.documentElement;
  for (const [prop, val] of Object.entries(_customThemeColors)) {
    root.style.setProperty(prop, val);
  }
  _applyTerminalThemes();
}

/* ── Reset to CSS defaults (remove inline overrides) ───── */

function resetThemeToDefault() {
  _currentTheme = 'default';
  const root = document.documentElement;
  THEME_CSS_KEYS.forEach(k => root.style.removeProperty(k));
  _applyTerminalThemes();
}

/* ── Get the xterm.js theme for the current palette ────── */

function getTerminalTheme() {
  if (_currentTheme === 'custom') {
    const base = THEMES.default.terminal;
    return { ...base };
  }
  const theme = THEMES[_currentTheme];
  return theme ? { ...theme.terminal } : { ...THEMES.default.terminal };
}

/* ── Update existing terminal instances ────────────────── */

function _applyTerminalThemes() {
  const xt = getTerminalTheme();
  if (typeof _termSessions !== 'undefined') {
    _termSessions.forEach(s => {
      if (s.term) s.term.options.theme = xt;
    });
  }
  if (typeof _codeTerms !== 'undefined') {
    for (const id of Object.keys(_codeTerms)) {
      const t = _codeTerms[id];
      if (t?.term) t.term.options.theme = xt;
    }
  }
}

/* ── Load & apply on startup ───────────────────────────── */

async function themeApplyOnLoad() {
  try {
    const prefs = await apiFetch('/api/prefs');
    const name = prefs.theme || 'default';
    if (name === 'custom' && prefs.customTheme) {
      _customThemeColors = prefs.customTheme;
      applyCustomTheme(prefs.customTheme);
    } else if (name !== 'default' && THEMES[name]) {
      applyTheme(name);
    } else {
      _currentTheme = 'default';
    }
  } catch {}
}
