'use strict';

/**
 * This machine's files, backed up (docs: AGENTS.md "This machine's files, backed up"): what the person chose — where,
 * which folders, when, how many to keep — and the secrets beside it.
 *
 * The choices are prefs `machineBackup`, declared in settings-schema.js and never proposable: what of a person's files
 * leaves the machine, and where to, is theirs. The repository's password and a remote's keys live in
 * `keys/machine-backup.json` (0600, the protected keys folder, PROTECTED_FILES), written through keys-file.js so a
 * power cut cannot empty it; no route ever hands either back, except the password once, the moment it is made.
 */
const crypto = require('crypto');
const schema = require('../settings-schema');
const { loadPrefs, savePrefs } = require('../utils');

const keysFile = () => require('../paths').MACHINE_BACKUP_KEYS_FILE;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** The person's choices, each through its declared type and default. `folders` empty means the suggestions. */
function get(prefs = loadPrefs()) {
  const v = k => schema.value(`machineBackup.${k}`, prefs);
  return { enabled: v('enabled'), repo: v('repo'), folders: v('folders'), exclude: v('exclude'), at: v('at'),
    catchUp: v('catchUp'), keepDaily: v('keepDaily'), keepWeekly: v('keepWeekly'), keepMonthly: v('keepMonthly') };
}

/** A path list from the panel: strings, trimmed, no empty ones, no duplicates, no NUL. */
function cleanList(list, what) {
  if (!Array.isArray(list)) throw bad(`${what} is a list.`);
  const out = [];
  for (const x of list) {
    const s = String(x ?? '').trim();
    if (!s) continue;
    if (s.includes('\0') || s.length > 4096) throw bad(`${what}: "${s.slice(0, 40)}" is not a path or pattern.`);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

const isAbsolute = p => require('path').isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);
/** A restic address (s3:, b2:, sftp:, rest:, azure:, gs:, swift:, rclone:) rather than a folder. */
const isRemote = repo => /^(s3|b2|sftp|rest|azure|gs|swift|rclone):/i.test(String(repo || ''));

/** Save part of the choices, checked; returns them all. */
function set(patch = {}) {
  const next = { ...get() };
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.repo !== undefined) {
    const r = String(patch.repo || '').trim();
    if (r && !isRemote(r) && !isAbsolute(r)) throw bad('Where the backup goes is a full folder path (another disk, a NAS mount), or a restic address such as sftp:user@host:/path.');
    if (r.includes('\0') || r.length > 2048) throw bad('That is not a folder or an address.');
    next.repo = r;
  }
  if (patch.folders !== undefined) {
    next.folders = cleanList(patch.folders, 'Folders');
    const rel = next.folders.find(f => !isAbsolute(f));
    if (rel) throw bad(`"${rel}" is not a full path: choose it from the tree, or type it from the top (/home/… or C:\\…).`);
  }
  if (patch.exclude !== undefined) next.exclude = cleanList(patch.exclude, 'Left out');
  if (patch.at !== undefined) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(patch.at));
    if (!m || +m[1] > 23 || +m[2] > 59) throw bad('The time is HH:MM.');
    next.at = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  if (patch.catchUp !== undefined) next.catchUp = !!patch.catchUp;
  for (const [k, lo, hi] of [['keepDaily', 1, 366], ['keepWeekly', 0, 520], ['keepMonthly', 0, 240]]) {
    if (patch[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${k} is a whole number from ${lo} to ${hi}.`);
    next[k] = n;
  }
  if (next.enabled && !next.repo) throw bad('Choose where the backup goes first.');
  const prefs = loadPrefs();
  const was = prefs.machineBackup || {};
  prefs.machineBackup = { ...was, ...next };
  savePrefs(prefs);
  // Counting starts when it is switched on: a slot that passed before is not "missed".
  if (next.enabled && !was.enabled) require('./state').patch({ enabledAt: new Date().toISOString() });
  return get();
}

/* ── The secrets ── */

function keys() { return require('../keys-file').read(keysFile(), {}); }
function writeKeys(k) { require('../keys-file').write(keysFile(), k); }

/** The repository's password, or null. Only restic.js and the routes that check a typed one read it. */
function password() { const p = keys().password; return typeof p === 'string' && p ? p : null; }
function savePassword(p) {
  const s = String(p || '');
  if (s.length < 8) throw bad('A backup password has at least 8 characters.');
  writeKeys({ ...keys(), password: s });
}

/** A remote's keys ({id, secret}), sent to restic in the environment its backend reads. */
function remoteKeys() { const r = keys().remote; return r && typeof r === 'object' ? { id: String(r.id || ''), secret: String(r.secret || '') } : null; }
function saveRemoteKeys({ id, secret } = {}) {
  const k = keys();
  if (!id && !secret) delete k.remote; else k.remote = { id: String(id || ''), secret: String(secret || '') };
  writeKeys(k);
}

/** What may be said about the secrets: whether they are there, never what they are. */
function secretsView() { const r = remoteKeys(); return { hasPassword: !!password(), hasRemoteKeys: !!(r && (r.id || r.secret)) }; }

/** A password to write down: six groups of five letters and digits with nothing that reads two ways (~150 bits). */
function makePassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(30);
  return Array.from({ length: 6 }, (_, g) => Array.from({ length: 5 }, (_, i) => A[b[g * 5 + i] % A.length]).join('')).join('-');
}

module.exports = { get, set, isRemote, isAbsolute, password, savePassword, remoteKeys, saveRemoteKeys, secretsView, makePassword };
