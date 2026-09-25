'use strict';

/**
 * Whether backups are encrypted, and the password remembered for them.
 *
 * Encryption is the user's choice (TODO.md, settled 2026-09-25): on by default,
 * and an open backup is allowed — it then carries every API key, token and
 * private conversation in the clear, and whoever holds the file holds them.
 *
 * A remembered password is kept in its own file, mode 0600, never in the prefs
 * file (which the panel serves and the agent's file tools can reach, ISSUES.md
 * H-19). It is write-only from the UI: settable, replaceable, forgettable, never
 * shown or returned by any route. The agent's file tools refuse its path
 * (`paths.PROTECTED_FILES`). What that does not stop is `shell`, which runs as
 * the same user — on one account nothing is hidden from a shell, and the UI says
 * so rather than implying otherwise.
 */
const fs   = require('fs');
const { BACKUP_PASSWORD_FILE } = require('../paths');
const { loadPrefs, savePrefs } = require('../utils');

function settings() {
  const b = loadPrefs().backup || {};
  return {
    encrypt: b.encrypt !== false,                  // default: on
    hasSavedPassword: saved() !== null,
  };
}

function setEncrypt(on) {
  const prefs = loadPrefs();
  prefs.backup = { ...(prefs.backup || {}), encrypt: !!on };
  savePrefs(prefs);
}

/** The remembered password, or null. */
function saved() {
  try {
    const p = fs.readFileSync(BACKUP_PASSWORD_FILE, 'utf8');
    return p.length ? p : null;
  } catch { return null; }
}

function save(password) {
  const p = String(password || '');
  if (p.length < 8) throw Object.assign(new Error('Use at least 8 characters for a backup password.'), { status: 400 });
  fs.writeFileSync(BACKUP_PASSWORD_FILE, p, { mode: 0o600 });
  fs.chmodSync(BACKUP_PASSWORD_FILE, 0o600);   // an existing file keeps its old mode otherwise
}

function forget() {
  fs.rmSync(BACKUP_PASSWORD_FILE, { force: true });
}

/**
 * The password a backup is made with: the one typed for it, else the remembered
 * one; null for an open backup. Encryption on with no password at all is an
 * error, never a silent open backup.
 */
function passwordFor(typed) {
  if (!settings().encrypt) return null;
  const p = typed ? String(typed) : saved();
  if (!p) throw Object.assign(new Error('Backups are password-protected: type a password, or save one in Settings → Backups.'), { status: 400 });
  return p;
}

module.exports = { settings, setEncrypt, saved, save, forget, passwordFor };
