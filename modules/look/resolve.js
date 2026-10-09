'use strict';

/**
 * A device's look, resolved: the palette, ground, fonts and corners its screen settings (`theme`, `customTheme`,
 * `skin`) draw in the panel — so an app's own screens can be drawn the panel's way (GET /api/v1/settings/look,
 * PROTOCOL §14.1). Exactly what the browser does: themes.js themeApplyOnLoad picks the theme (an unknown name or none is
 * the default; `custom` is the default's colours under the person's own), variables.css supplies what a theme does
 * not name (`--on-accent` is the ground, `--stopped` the faint line, `--field` the cyan), look.js lookApply picks the
 * style (an unknown one is Classic), and look-points.js themeGroundOf says light or dark.
 */
const crypto = require('crypto');
const { table } = require('./palettes');

const camel = k => k.replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NOT_COLOURS = new Set(['--font-mono', '--text-muted']);

/** `#abc` → `#aabbcc`; anything that is not a hex colour → null (a device draws hex, not CSS). */
function hex(v) {
  const s = String(v || '').trim();
  if (!HEX.test(s)) return null;
  return s.length === 4 ? `#${[...s.slice(1)].map(c => c + c).join('')}`.toLowerCase() : s.toLowerCase();
}

/** A value with `var(--x)` replaced from the map, a few levels deep. */
function deref(v, vars, depth = 0) {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(String(v || '').trim());
  if (!m) return v;
  if (depth > 5) return m[2] || '';
  return deref(vars[m[1]] !== undefined ? vars[m[1]] : m[2], vars, depth + 1);
}

/** The browser's themeGroundOf: light when the ground's luminance is over a half. */
function groundOf(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bg || '').trim());
  if (!m) return 'dark';
  const v = parseInt(m[1], 16), lum = (0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
  return lum > 0.5 ? 'light' : 'dark';
}

/** `'IBM Plex Sans', system-ui, sans-serif` → ['IBM Plex Sans', 'system-ui', 'sans-serif']. */
const families = v => String(v || '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const px = v => { const m = /^(-?[\d.]+)px$/.exec(String(v || '').trim()); return m ? Number(m[1]) : null; };

/** The theme a screen's settings name, as the browser applies it: {id, label, colors}. */
function themeOf(settings, t) {
  const name = settings.theme || 'default';
  if (name === 'custom' && settings.customTheme && typeof settings.customTheme === 'object') {
    const own = Object.fromEntries(Object.entries(settings.customTheme).filter(([k, v]) => /^--[\w-]+$/.test(k) && hex(v)));
    return { id: 'custom', label: 'Custom', colors: { ...t.themes.default.colors, ...own } };
  }
  const id = t.themes[name] ? name : 'default';
  return { id, label: t.themes[id].label, colors: t.themes[id].colors };
}

/** The look for a screen's effective settings ({theme, customTheme, skin}). */
function resolve(settings = {}) {
  const t = table();
  const theme = themeOf(settings, t);
  const skin = t.skins[settings.skin] ? settings.skin : 'classic';
  // The root's properties, the skin's over them, the theme's inline over both — the order the page cascades them in.
  const vars = { ...t.skinVars[skin], ...theme.colors };
  const palette = {};
  for (const k of t.keys) {
    if (NOT_COLOURS.has(k)) continue;
    const v = hex(deref(vars[k], vars));
    if (v) palette[camel(k)] = v;
  }
  const font = k => families(deref(vars[k], vars));
  const look = {
    theme: theme.id, themeLabel: theme.label,
    skin, skinLabel: t.skins[skin].label,
    ground: groundOf(palette.bg),
    palette,
    fonts: { ui: font('--font-ui'), text: font('--font-text'), display: font('--font-display'), mono: font('--font-mono') },
    radius: { control: px(deref(vars['--radius'], vars)), card: px(deref(vars['--radius-card'] || vars['--radius'], vars)) },
    inputSize: px(deref(vars['--fs-input'], vars)),
  };
  look.etag = crypto.createHash('sha1').update(JSON.stringify(look)).digest('hex').slice(0, 12);
  return look;
}

module.exports = { resolve, groundOf, hex, families };
