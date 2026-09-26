'use strict';

/**
 * Backups on a schedule, and how many of them to keep.
 *
 * Off by default. When on, a backup is made daily or weekly at a set time
 * (local), named `auto-…` so that keeping the last N touches only these — a
 * backup somebody made by hand, uploaded, or the safety copy a restore makes,
 * is never removed by this.
 *
 * An encrypted schedule needs the remembered password (secret.js), which is
 * why that exists: with none saved, the scheduled backup is not made and the
 * reason is shown in Settings → Backups — never an open backup instead.
 *
 * Settings: prefs `backup.schedule` { every: off|daily|weekly, at: "HH:MM", keep }.
 * State: `<DATA_DIR>/backup/schedule.json` { lastAt, lastName, lastTriedAt, lastError, since }.
 */
const fs   = require('fs');
const path = require('path');

const store   = require('../store');
const { loadPrefs, savePrefs } = require('../utils');

const EVERY = { off: 0, daily: 24 * 3600e3, weekly: 7 * 24 * 3600e3 };
const DEFAULTS = { every: 'off', at: '03:00', keep: 7 };
const TICK_MS = 5 * 60e3;
const PREFIX = 'auto-';

const bad = msg => Object.assign(new Error(msg), { status: 400 });

function config() {
  const s = { ...DEFAULTS, ...((loadPrefs().backup || {}).schedule || {}) };
  return { every: s.every in EVERY ? s.every : 'off', at: /^\d{2}:\d{2}$/.test(s.at) ? s.at : DEFAULTS.at, keep: Number(s.keep) || DEFAULTS.keep };
}

function setConfig(patch = {}) {
  const next = { ...config() };
  if (patch.every !== undefined) {
    if (!(patch.every in EVERY)) throw bad('every is off, daily or weekly.');
    next.every = patch.every;
  }
  if (patch.at !== undefined) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(patch.at));
    if (!m || +m[1] > 23 || +m[2] > 59) throw bad('at is a time of day, HH:MM.');
    next.at = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  if (patch.keep !== undefined) {
    const k = Number(patch.keep);
    if (!Number.isInteger(k) || k < 1 || k > 365) throw bad('keep is between 1 and 365.');
    next.keep = k;
  }
  const prefs = loadPrefs();
  prefs.backup = { ...(prefs.backup || {}), schedule: next };
  savePrefs(prefs);
  // Counting starts now: switching it on does not make a backup for every slot it missed.
  const st = state();
  if (next.every !== 'off' && !st.since) writeState({ ...st, since: new Date().toISOString() });
  if (next.every === 'off') writeState({ ...st, since: null });
  return status();
}

function state() { return store.readJson('backup/schedule', {}); }
function writeState(s) { store.writeJson('backup/schedule', s); }

/** The first HH:MM (local) at or after t. */
function slotAfter(t, at) {
  const [h, m] = at.split(':').map(Number);
  const d = new Date(t);
  d.setHours(h, m, 0, 0);
  if (d.getTime() < t) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** When the next scheduled backup is due, or null when off. */
function nextAt(cfg = config(), st = state()) {
  if (cfg.every === 'off') return null;
  const t = v => (v ? Date.parse(v) || 0 : 0);   // not Date.parse(0): that reads "0" as the year 2000
  const last = Math.max(t(st.lastAt), t(st.lastTriedAt));
  // Half a day of slack, so a daily backup at 03:00 is not pushed to the day
  // after because the last one finished at 03:04.
  const from = last ? last + EVERY[cfg.every] - 12 * 3600e3 : Date.parse(st.since || new Date().toISOString());
  return slotAfter(from, cfg.at);
}

function status() {
  const cfg = config(), st = state(), n = nextAt(cfg, st);
  return { ...cfg, nextAt: n ? new Date(n).toISOString() : null,
    lastAt: st.lastAt || null, lastName: st.lastName || null, lastError: st.lastError || null, lastTriedAt: st.lastTriedAt || null };
}

/** Keep the newest `keep` automatic backups; the rest go. Returns what was removed. */
function prune(keep = config().keep, dir = require('../paths').BACKUP_DIR) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.startsWith(PREFIX) && n.endsWith('.dBac')); } catch { return []; }
  const byAge = names.map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  const drop = byAge.slice(keep).map(x => x.n);
  for (const n of drop) fs.rmSync(path.join(dir, n), { force: true });
  return drop;
}

let _running = false;

/** Make the scheduled backup now (when due, from the timer; tests call it directly). */
async function run({ now = Date.now() } = {}) {
  if (_running) return { skipped: 'already running' };
  _running = true;
  const at = new Date(now).toISOString();
  try {
    const secret = require('./secret');
    const archive = require('./archive');
    const enc = secret.settings().encrypt;
    const password = enc ? secret.saved() : null;
    if (enc && !password)
      throw new Error('Backups are password-protected and no password is saved, so the scheduled backup was not made. Save one in Settings → Backups, or switch encryption off.');
    const b = await archive.create({ password, name: PREFIX + archive.fileName(new Date(now)) });
    const removed = prune();
    writeState({ ...state(), lastAt: at, lastTriedAt: at, lastName: b.name, lastError: null });
    return { made: b.name, removed };
  } catch (e) {
    console.warn(`[backup] scheduled backup failed: ${e.message}`);
    writeState({ ...state(), lastTriedAt: at, lastError: e.message });
    return { error: e.message };
  } finally { _running = false; }
}

function tick() {
  const n = nextAt();
  if (n && Date.now() >= n) run().catch(() => {});
}

let _timer = null;
function start() {
  if (_timer) return;
  _timer = setInterval(tick, TICK_MS);
  _timer.unref?.();
  setTimeout(tick, 60e3).unref?.();
}

module.exports = { config, setConfig, status, nextAt, slotAfter, prune, run, start, PREFIX };
