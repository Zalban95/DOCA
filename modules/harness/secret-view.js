'use strict';

/**
 * The files that hold secrets beside settings, as the agent's file tools see them (audit 2026-10-06, coh F1).
 *
 * The keys files are refused outright (paths.PROTECTED_FILES), but the panel's settings file still holds a few
 * secrets — a channel's bot token, an MCP server's env and headers (Home Assistant's bearer) — and so do its copies
 * (the `.bak`, the migrations' and checkpoints' copies, write_file's backups), OpenClaw's config (provider keys) and
 * a `.env`. Refusing them would cost the agent the settings it is meant to read and propose changes to; instead
 * read_file shows them with every secret-named value as `secretsMask.MASK` (the rule GET /api/prefs follows),
 * search_files leaves them out, http_fetch will not upload one, and write_file refuses a write carrying the mask —
 * the agent read dots, and writing them back would replace the real secret.
 *
 * `shell` runs as the same user and can still `cat` them: the stated limit of one account on one machine.
 */
const path = require('path');
const { mask, MASK } = require('../secrets-mask');

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (abs, dir) => { const r = path.relative(dir, abs); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
const secretName = k => mask({ [k]: 'x' })[k] === MASK;

/** 'json', 'checkpoint', 'env' or null: how `abs` holds secrets, if it is one of these files. */
function kindOf(abs) {
  const paths = require('../paths');
  const data = require('../store').DATA_DIR;
  abs = path.resolve(abs);
  let real = abs;
  try { real = require('../utils').realOf(abs); } catch { /* not there yet */ }
  const base = path.basename(real).replace(/\.bak$/, '');
  const named = [paths.PREFS_FILE, paths.CONFIG_PATH].map(f => path.resolve(f));
  if (named.some(f => [f, `${f}.bak`].some(p => same(p, abs) || same(p, real)))) return 'json';
  if (inside(real, path.join(data, 'checkpoints'))) return 'checkpoint';
  if (inside(real, path.join(data, 'migrations')) && /^prefs-.*\.json$/.test(base)) return 'json';
  if (inside(real, path.join(data, 'harness', 'backups')) && named.some(f => same(path.basename(f), base))) return 'json';
  if (/^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base)) return 'env';
  return null;
}

/** `"name": "value"` and `NAME=value` lines with the value masked when the name is secret-shaped. */
function maskLines(text, kind) {
  if (kind === 'env')
    return text.replace(/^(\s*(?:export\s+)?)([A-Za-z_][\w.]*)(\s*=\s*)(.*)$/gm,
      (all, pre, k, eq, v) => (v.trim() && secretName(k) ? `${pre}${k}${eq}${MASK}` : all));
  return text.replace(/"([^"\\]+)"(\s*:\s*)"(?:[^"\\]|\\.)*"/g, (all, k, colon) => (secretName(k) ? `"${k}"${colon}"${MASK}"` : all));
}

function maskJson(text) {
  const doc = JSON.parse(text);
  return JSON.stringify(mask(doc), null, 2);
}

/** The text the agent may read of `abs`: as it is, or masked. */
function view(abs, text) {
  const kind = kindOf(abs);
  if (!kind) return text;
  try {
    if (kind === 'json') return maskJson(text);
    if (kind === 'checkpoint') {
      const c = JSON.parse(text);
      if (typeof c.prefs === 'string') { try { c.prefs = JSON.parse(c.prefs); } catch { c.prefs = maskLines(c.prefs, 'json'); } }
      return JSON.stringify(mask(c), null, 2);
    }
  } catch { /* not JSON after all: line by line */ }
  return maskLines(text, kind === 'env' ? 'env' : 'json');
}

/** Why `content` must not be written to `abs` (it carries the mask into a file that holds secrets), or null. */
function maskedWrite(abs, content) {
  if (!kindOf(abs) || !String(content ?? '').includes(MASK)) return null;
  return `${abs} holds secrets, and this content carries ${MASK} where read_file hid them — writing it would replace `
    + 'the real values. Change settings with settings_propose; edit the file without the masked lines, or ask the person.';
}

module.exports = { kindOf, view, maskedWrite, MASK };
