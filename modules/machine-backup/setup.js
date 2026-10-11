'use strict';

/**
 * Making the backup's repository, joining one that exists (a fresh install bringing its files back), and changing its
 * password. The password DOCA makes is shown once, the moment it is made — "save it somewhere safe: a fresh install
 * needs it" — and kept in keys/machine-backup.json; no route hands it back afterwards. Changing it is restic's own
 * `key add` then `key remove` of the old key, so the repository never has a moment with no key that DOCA knows.
 */
const fs = require('fs');

const restic = require('./restic');
const config = require('./config');
const destination = require('./destination');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const note = (what, person) => { try { require('../activity').note({ from: 'machine-backup', what, why: 'a person asked (Settings → Backups)', person }); } catch { /* a record */ } };

function checkRepo(repo) {
  const r = String(repo || '').trim();
  if (!r) throw bad('Choose where the backup goes.');
  if (!config.isRemote(r) && !config.isAbsolute(r)) throw bad('Where the backup goes is a full folder path (another disk, a NAS mount), or a restic address such as sftp:user@host:/path.');
  const d = destination.check(r);
  if (d.reachable === false) throw bad(d.note, 409);
  return { repo: r, dest: d };
}

/** A new repository with a password DOCA makes: {password} — the only time it is returned. */
async function create({ repo, remote = null } = {}, person = null) {
  const { repo: r, dest } = checkRepo(repo);
  if (dest.initialized) throw bad('There is already a backup there. To use it, choose "Bring back a machine backup" and type its password.', 409);
  if (remote) config.saveRemoteKeys(remote);
  if (dest.kind === 'folder') fs.mkdirSync(r, { recursive: true });
  const password = config.makePassword();
  await restic.run(['init', '--json'], { repo: r, password });
  config.savePassword(password);
  config.set({ repo: r });
  require('./state').patch({ initializedAt: new Date().toISOString(), repoInitialized: r });
  note(`set up the backup of this machine's files in ${r}`, person);
  return { ok: true, repo: r, password };
}

/** An existing repository, opened with its password (a fresh install, or another machine's backup). */
async function connect({ repo, password, remote = null } = {}, person = null) {
  const { repo: r } = checkRepo(repo);
  if (!password || String(password).length < 8) throw bad('Type the backup\'s password.');
  if (remote) config.saveRemoteKeys(remote);
  try { await restic.run(['cat', 'config'], { repo: r, password: String(password) }); }
  catch (e) {
    if (e.resticCode === 12) throw bad('That password does not open this backup.', 403);
    if (e.resticCode === 10) throw bad('There is no backup there yet. To start one, choose "Set it up".', 404);
    throw e;
  }
  config.savePassword(String(password));
  config.set({ repo: r });
  require('./state').patch({ initializedAt: new Date().toISOString(), repoInitialized: r });
  note(`joined the machine backup in ${r}`, person);
  return { ok: true, repo: r };
}

/** A new password for the repository: added as a key, then the old key removed. {password} when DOCA made it. */
async function changePassword({ password = null } = {}, person = null) {
  const old = config.password();
  if (!old) throw bad('There is no backup set up yet.', 409);
  const next = password ? String(password) : config.makePassword();
  if (next.length < 8) throw bad('A backup password has at least 8 characters.');
  const keys = JSON.parse((await restic.run(['key', 'list', '--json'])).stdout || '[]');
  const current = keys.find(k => k.current);
  await restic.withPasswordFile(next, file => restic.run(['key', 'add', '--new-password-file', file]));
  if (current) await restic.run(['key', 'remove', current.id], { password: next });
  config.savePassword(next);
  note('changed the password of this machine\'s backup', person);
  return password ? { ok: true } : { ok: true, password: next };
}

module.exports = { create, connect, changePassword };
