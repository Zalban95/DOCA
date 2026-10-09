'use strict';

/**
 * The panel's looks, read from the front end's own files — so a device's app draws the palette the panel draws and
 * the two cannot drift. The themes are public/js/themes.js, look.js and look-points.js (classic scripts that only
 * declare and paint <html>; run in a sandbox with a stub document and localStorage they paint nothing); a style's
 * shape and type are the custom properties of public/css/variables.css (Classic) under each skin's own
 * `html[data-skin="…"]` block (skin-modern.css, skin-points.css). Read once per process.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

/** THEMES (colours only), SKINS and THEME_CSS_KEYS as the browser has them. */
function evaluate() {
  const style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
  const ctx = {
    document: { documentElement: { style, dataset: {} }, getElementById: () => null },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem() {} },
  };
  vm.runInNewContext(`${read('js/themes.js')}\n${read('js/look.js')}\n${read('js/look-points.js')}\n`
    + 'this.out = { THEMES: Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, { label: t.label, colors: t.colors }])), SKINS, THEME_CSS_KEYS };', ctx);
  return JSON.parse(JSON.stringify(ctx.out));
}

/** The custom properties declared in a CSS block: `--name: value;` → {'--name': 'value'}. */
function declared(block) {
  const out = {};
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** The first `{…}` after `selector` in a stylesheet. */
function blockAfter(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return '';
  const open = css.indexOf('{', at), close = css.indexOf('}', open);
  return open < 0 || close < 0 ? '' : css.slice(open + 1, close);
}

/** {classic: vars, modern: vars, points: vars}: the root's properties, each skin's own over them. */
function skinVars(skins) {
  const root = declared(blockAfter(read('css/variables.css'), ':root'));
  const out = { classic: root };
  for (const id of Object.keys(skins)) {
    if (id === 'classic') continue;
    let css = '';
    try { css = read(`css/skin-${id}.css`); } catch { /* a skin without a stylesheet is Classic's shape */ }
    out[id] = { ...root, ...declared(blockAfter(css, `html[data-skin="${id}"]`)) };
  }
  return out;
}

let _table = null;
/** {themes, skins, keys, skinVars} — the whole table, cached. */
function table() {
  if (_table) return _table;
  const { THEMES, SKINS, THEME_CSS_KEYS } = evaluate();
  _table = { themes: THEMES, skins: SKINS, keys: THEME_CSS_KEYS, skinVars: skinVars(SKINS) };
  return _table;
}

module.exports = { table, declared, blockAfter };
