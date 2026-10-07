'use strict';

/**
 * What the hub does on its own, written down (CONSTITUTION §1: "nothing runs unseen, but it can be unrendered"; TODO
 * P1.8). A turn, a mission and a device job are runs (harness/runs.js) and Chronicle tells them; what is left is the
 * hub acting without a turn — a computer stopped or removed by the tidy-up, an MCP server started or resumed at boot,
 * a schedule firing, the model scout looking, a channel bot starting, the log keeper pruning, a backup. Each such
 * act is one line here: what, why, on whose behalf (a person, or the routine itself), from which part of the hub.
 *
 * Kept on disk a file per day (DATA_DIR/activity/YYYY-MM-DD.jsonl) for `logs.activityDays` (log-keep.js prunes it),
 * pushed on the live feed's `activity` topic so a page that shows it draws it as it happens, and read back by
 * Chronicle (source `hub`). Names and reasons only — never a secret, never content. Writing a line must never break
 * the thing it records.
 */
const fs = require('fs');
const path = require('path');

const dir = () => path.join(require('./store').DATA_DIR, 'activity');
const day = (t = new Date()) => t.toISOString().slice(0, 10);

/**
 * One act of the hub's own. `from`: the part of the hub (computers, mcp, schedules, scout, channels, log-keep, backup…);
 * `what`: what it did, a phrase; `why`: the reason it did it now; `person`: on whose behalf, when someone's.
 */
function note({ from, what, why = '', person = null, level = 'info', sessionId = null } = {}) {
  try {
    const row = { at: new Date().toISOString(), from: String(from || 'hub').slice(0, 40), what: String(what || '').slice(0, 300),
      why: String(why || '').slice(0, 300), level: ['info', 'warn', 'error'].includes(level) ? level : 'info',
      ...(person?.id ? { person: { id: person.id, name: person.name || person.email || person.id } } : {}),
      ...(sessionId ? { sessionId } : {}) };
    require('./store').appendJsonl(path.join(dir(), `${day()}.jsonl`), row);
    require('./live').changed('activity', row.from, row.what);
    return row;
  } catch { return null; }
}

/** Lines between two dates, newest first, at most `limit`. */
function list({ since = null, until = null, limit = 500 } = {}) {
  let files = [];
  try { files = fs.readdirSync(dir()).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse(); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (since && f.slice(0, 10) < String(since).slice(0, 10)) break;
    const rows = require('./store').readJsonl(path.join(dir(), f)).reverse();
    for (const r of rows) {
      if (until && r.at > until) continue;
      if (since && r.at < since) return out;
      out.push(r);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Days older than `days` removed; returns how many files went. */
function prune(days) {
  const cut = day(new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000));
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir())) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cut) { fs.rmSync(path.join(dir(), f), { force: true }); n++; }
  } catch { /* no folder yet */ }
  return n;
}

module.exports = { note, list, prune, dir };
