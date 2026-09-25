'use strict';

/**
 * Putting a `.dBac` back.
 *
 * Nothing is replaced until everything has been checked. In order:
 *   1. the password opens the manifest;
 *   2. the backup's data format is one this code can read — newer data is
 *      refused, with the version that can read it; older data is migrated
 *      forward, one step at a time, or refused if a step is missing;
 *   3. every section is unpacked beside its target (same filesystem, so the
 *      swap is a rename) and every file is checked against its checksum;
 *   4. the current state is itself backed up, so a restore can be undone;
 *   5. each section is swapped in, and the panel restarts to read it.
 * A failure before step 5 leaves the machine exactly as it was.
 */
const fs   = require('fs');
const path = require('path');

const archive = require('./archive');
const store   = require('../store');

/**
 * Data migrations, by the format they upgrade *from*. Empty while there has
 * only ever been format 1; the first change to the stored shape adds `1: dir =>
 * { … }` here and bumps `docaDataFormat` in package.json.
 */
const MIGRATIONS = {};

/** Why this backup cannot be restored by this code, or null. */
function incompatibility(manifest) {
  const have = Number(manifest.dataFormat) || 1, can = store.DATA_FORMAT;
  if (have > can)
    return `This backup was made by DOCA ${manifest.appVersion} with data format ${have}; this version reads up to format ${can}. `
      + `Switch to v${manifest.appVersion} or newer (Settings → Updates → Version) and restore it there.`;
  for (let f = have; f < can; f++)
    if (!MIGRATIONS[f]) return `This backup's data is format ${have}, and there is no way here from format ${f} to ${f + 1}. Restore it with a version between ${manifest.appVersion} and this one first.`;
  return null;
}

/** Put the current accounts into the staged data, if there are any. @returns {boolean} */
function keepAccounts(current, stage) {
  const users = path.join(current, 'auth', 'users.json');
  let has = false;
  try { has = Object.keys(JSON.parse(fs.readFileSync(users, 'utf8'))).length > 0; } catch {}
  if (!has) return false;
  fs.rmSync(path.join(stage, 'auth'), { recursive: true, force: true });
  fs.cpSync(path.join(current, 'auth'), path.join(stage, 'auth'), { recursive: true });
  return true;
}

/** What a restore would do, without doing it: for the confirmation the user reads. */
async function plan(file, password) {
  const opened = await archive.open(file, password);
  try {
    const m = opened.manifest;
    const present = new Set(m.contents.map(c => c.path.split('/')[0]));
    const here = new Map(archive.sections().map(s => [s.name, s]));
    return {
      appVersion: m.appVersion, createdAt: m.createdAt, host: m.host, dataFormat: m.dataFormat,
      encrypted: opened.encrypted, files: m.contents.length,
      bytes: m.contents.reduce((n, c) => n + c.bytes, 0),
      sections: m.sections.filter(s => present.has(s.name) && here.has(s.name))
        .map(s => ({ name: s.name, what: s.what, to: here.get(s.name).at })),
      problem: incompatibility(m),
    };
  } finally { await opened.reader.close(); }
}

/**
 * Restore `file`. `safety` makes the before-restore backup (the caller passes
 * archive.create with the right password); it runs after verification and
 * before anything is replaced.
 * @returns {Promise<{ restored: string[], files: number, safetyBackup: string|null }>}
 */
async function restore(file, { password = null, safety = null, say = () => {} } = {}) {
  const opened = await archive.open(file, password);
  const staged = [];   // { section, stage, target, kind }
  try {
    const why = incompatibility(opened.manifest);
    if (why) throw Object.assign(new Error(why), { status: 409 });

    const present = new Set(opened.manifest.contents.map(c => c.path.split('/')[0]));
    const stamp = Date.now();
    let files = 0;
    for (const s of archive.sections()) {
      if (!present.has(s.name)) continue;
      const target = s.at;
      const parent = path.dirname(target);
      fs.mkdirSync(parent, { recursive: true });
      const stage = path.join(parent, `.${path.basename(target)}.restore-${stamp}`);
      say(`Checking ${s.name} (${s.what})…\n`);
      const n = await archive.extractSection(opened, s.name, stage, password);
      files += n;
      staged.push({ section: s.name, stage, target, kind: s.kind });
    }
    say(`✓ ${files} files verified against their checksums.\n`);

    // Accounts are not restored over an install that has them. They live in the
    // data directory, so a backup from before accounts existed would otherwise
    // wipe them and put the panel back in setup mode — claimable by whoever gets
    // there first — and any older backup would silently bring back old
    // passwords and sessions. On an install without accounts (a new machine)
    // the backup's accounts come along, which is how an owner moves house.
    const data = staged.find(x => x.section === 'data');
    const keptAccounts = data && keepAccounts(store.DATA_DIR, data.stage);
    if (keptAccounts) say('Accounts: this install already has them, so they were kept as they are.\n');

    // Migrations would run here, on the staged data directory, before the swap.
    const from = Number(opened.manifest.dataFormat) || 1;
    for (let f = from; f < store.DATA_FORMAT; f++) { say(`Migrating data format ${f} → ${f + 1}…\n`); await MIGRATIONS[f](data.stage); }

    let safetyBackup = null;
    if (safety) {
      say('Backing up the current state first, so this can be undone…\n');
      safetyBackup = (await safety()).name;
      say(`✓ ${safetyBackup}\n`);
    }

    swap(staged, stamp, say);
    return { restored: staged.map(x => x.section), files, safetyBackup };
  } finally {
    for (const x of staged) fs.rmSync(x.stage, { recursive: true, force: true });
    await opened.reader.close();
  }
}

/**
 * Move each staged section into place. The old copy is moved aside first and
 * removed only when every section is in — if one fails, the ones already
 * swapped are put back, so a restore is all or nothing.
 */
function swap(staged, stamp, say) {
  const done = [];
  try {
    for (const x of staged) {
      // A file section holds one file, named as it was on the machine that made
      // the backup; it goes to this machine's path, whatever that is called.
      const src = x.kind === 'dir' ? x.stage : path.join(x.stage, fs.readdirSync(x.stage)[0]);
      const aside = `${x.target}.pre-restore-${stamp}`;
      const had = fs.existsSync(x.target);
      if (had) fs.renameSync(x.target, aside);
      try { fs.renameSync(src, x.target); }
      catch (e) { if (had) fs.renameSync(aside, x.target); throw e; }
      done.push({ ...x, aside, had });
      say(`✓ ${x.section} restored.\n`);
    }
  } catch (e) {
    for (const d of done.reverse()) {
      try { fs.rmSync(d.target, { recursive: true, force: true }); if (d.had) fs.renameSync(d.aside, d.target); } catch {}
    }
    throw Object.assign(new Error(`Restore stopped and was undone: ${e.message}`), { status: 500 });
  }
  for (const d of done) if (d.had) fs.rmSync(d.aside, { recursive: true, force: true });
}

module.exports = { plan, restore, incompatibility, MIGRATIONS };
