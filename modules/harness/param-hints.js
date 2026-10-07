'use strict';

/**
 * The harness parameters' plain-words hints, for the agent (audit 2026-10-06, coh F14; TODO C3). They are written once,
 * beside each box of the ⚙ form (public/js/harness/param-table.js, HARNESS_PARAMS), and existed only in the browser —
 * so settings_read listed `compactAt = 75` with nothing saying what it does, and a setting the agent cannot understand
 * is one it will not propose well. The table is read here from that same file, in a context of its own, so the form
 * and the agent cannot drift apart.
 */
const fs = require('fs');
const path = require('path');

let cached = null;

/** { key: { label, unit, hint } } for every harness parameter the form shows. */
function hints() {
  if (cached) return cached;
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'harness', 'param-table.js'), 'utf8');
    const rows = require('vm').runInNewContext(`${src}\n;HARNESS_PARAMS`, {}, { timeout: 1000 });
    cached = Object.fromEntries(rows.map(r => [r.key, { label: r.label, unit: r.unit || null, hint: String(r.hint || '').replace(/\s+/g, ' ').trim() }]));
  } catch { cached = {}; }
  return cached;
}

module.exports = { hints };
