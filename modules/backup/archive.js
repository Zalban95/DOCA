'use strict';

/**
 * `.dBac`: a zip, AES-256 when a password is given, holding everything a DOCA
 * install is — data, prefs, .env, API keys, specialist definitions, attachments —
 * and a manifest that says what it is and proves every file arrived intact.
 *
 * The extension is its own so it opens as what it is. The format is plain
 * WinZip-AES zip (via @zip.js/zip.js), so 7-Zip, WinRAR and Keka open it with
 * the password. Never ZipCrypto, the old "classic" zip password: a backup always
 * holds known plaintext, which is exactly what breaks it. File *names* are not
 * encrypted by the zip format, only contents; the names here are DOCA's own
 * store paths.
 *
 * Cross-version by rule: the manifest records the data format, and a restore
 * refuses data newer than this code understands (and names the version that
 * does) — see restore.js.
 */
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { Writable } = require('stream');
const zip    = require('@zip.js/zip.js');

const paths = require('../paths');
const store = require('../store');
const pkg   = require('../../package.json');

zip.configure({ useWebWorkers: false });

const FORMAT = 'dBac';
const FORMAT_VERSION = 1;
const EXT = '.dBac';

/**
 * What goes in, as sections: a name inside the archive, and where it lives on
 * *this* machine. A restore maps each back to the same name's place on the
 * machine restoring it, which is what makes a backup portable.
 */
function sections() {
  return [
    { name: 'data',        kind: 'dir',  at: store.DATA_DIR,         what: 'conversations, memory, devices, media, missions' },
    { name: 'prefs',       kind: 'file', at: paths.PREFS_FILE,       what: 'panel settings' },
    { name: 'env',         kind: 'file', at: path.join(paths.HOME_DIR, '.env'), what: 'environment overrides' },
    { name: 'keys',        kind: 'file', at: paths.CONFIG_PATH,      what: "OpenClaw's config (DOCA's own keys are in data/keys)" },
    { name: 'agents',      kind: 'dir',  at: paths.AGENTS_DIR,       what: 'specialist definitions' },
    { name: 'attachments', kind: 'dir',  at: paths.ATTACHMENTS_DIR,  what: 'files attached to conversations' },
  ];
}

/** Leftovers of a write in progress, and logs, are not state. */
const SKIP = /(\.tmp$|^restart\.log$)/;

function walk(dir, base = dir) {
  let out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    // Checkpoint repositories (projects/checkpoints.js) are this machine's undo
    // history of project folders, not state: large, and useless elsewhere.
    if (e.isDirectory()) { if (!(dir === base && e.name === 'checkpoints')) out = out.concat(walk(abs, base)); }
    else if (e.isFile() && !SKIP.test(e.name)) out.push(path.relative(base, abs));
  }
  return out;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/** Every file that would go in: [{ section, rel, abs, zipPath }]. */
function inventory() {
  const files = [];
  for (const s of sections()) {
    if (s.kind === 'file') {
      if (fs.existsSync(s.at)) files.push({ section: s.name, rel: path.basename(s.at), abs: s.at, zipPath: `${s.name}/${path.basename(s.at)}` });
    } else {
      for (const rel of walk(s.at)) {
        files.push({ section: s.name, rel, abs: path.join(s.at, rel), zipPath: `${s.name}/${rel.split(path.sep).join('/')}` });
      }
    }
  }
  return files;
}

function fileName(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `doca-${os.hostname()}-${stamp}-v${pkg.version}${EXT}`;
}

/**
 * Write a backup to `dir` (default BACKUP_DIR). A null password makes an open
 * zip, on purpose — the caller decided (secret.passwordFor).
 * @returns {Promise<{ name: string, file: string, bytes: number, files: number, encrypted: boolean }>}
 */
async function create({ password = null, dir = paths.BACKUP_DIR, name = fileName() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const partial = `${file}.partial`;
  const files = inventory();

  const manifest = {
    format: FORMAT, formatVersion: FORMAT_VERSION,
    dataFormat: store.dataFormat(), appVersion: pkg.version,
    createdAt: new Date().toISOString(), host: os.hostname(), encrypted: !!password,
    sections: sections().map(({ name: n, kind, what }) => ({ name: n, kind, what })),
    contents: [],
  };
  for (const f of files) {
    const st = fs.statSync(f.abs);
    manifest.contents.push({ path: f.zipPath, bytes: st.size, sha256: await sha256File(f.abs), mtime: st.mtime.toISOString() });
  }

  const out = Writable.toWeb(fs.createWriteStream(partial, { mode: 0o600 }));
  const opts = password ? { password, encryptionStrength: 3 } : {};
  const writer = new zip.ZipWriter(out, opts);
  try {
    await writer.add('manifest.json', new zip.TextReader(JSON.stringify(manifest, null, 2)));
    for (const f of files) {
      await writer.add(f.zipPath, new zip.BlobReader(await fs.openAsBlob(f.abs)), { lastModDate: fs.statSync(f.abs).mtime });
    }
    await writer.close();
  } catch (e) {
    fs.rmSync(partial, { force: true });
    throw e;
  }
  fs.renameSync(partial, file);
  return { name, file, bytes: fs.statSync(file).size, files: files.length, encrypted: !!password };
}

/** Open a backup: its entries, and the manifest (needs the password when encrypted). */
async function open(file, password = null) {
  const reader = new zip.ZipReader(new zip.BlobReader(await fs.openAsBlob(file)));
  const entries = await reader.getEntries();
  const manifestEntry = entries.find(e => e.filename === 'manifest.json');
  if (!manifestEntry) throw Object.assign(new Error('Not a DOCA backup: it has no manifest.'), { status: 400 });
  if (manifestEntry.encrypted && !password)
    throw Object.assign(new Error('This backup is password-protected.'), { status: 401, code: 'password_required' });
  let manifest;
  try {
    manifest = JSON.parse(await manifestEntry.getData(new zip.TextWriter(), password ? { password } : {}));
  } catch (e) {
    if (/password/i.test(e.message)) throw Object.assign(new Error('Wrong password for this backup.'), { status: 401, code: 'wrong_password' });
    throw Object.assign(new Error(`Not a DOCA backup: the manifest is unreadable (${e.message}).`), { status: 400 });
  }
  if (manifest.format !== FORMAT) throw Object.assign(new Error('Not a DOCA backup: unknown format.'), { status: 400 });
  return { reader, entries, manifest, encrypted: manifestEntry.encrypted };
}

/** What can be said about a backup without its password. */
async function peek(file) {
  const reader = new zip.ZipReader(new zip.BlobReader(await fs.openAsBlob(file)));
  try {
    const entries = await reader.getEntries();
    const m = entries.find(e => e.filename === 'manifest.json');
    return { encrypted: !!m?.encrypted, files: Math.max(0, entries.length - 1), valid: !!m };
  } finally { await reader.close(); }
}

/**
 * Extract every file of one section into `destDir`, checking each against the
 * manifest's checksum. Throws on the first mismatch; the caller removes destDir.
 */
async function extractSection(opened, sectionName, destDir, password = null) {
  const byPath = new Map(opened.manifest.contents.map(c => [c.path, c]));
  const prefix = `${sectionName}/`;
  let count = 0;
  for (const e of opened.entries) {
    if (e.directory || !e.filename.startsWith(prefix)) continue;
    const rel = e.filename.slice(prefix.length);
    const dest = path.resolve(destDir, rel);
    if (!dest.startsWith(path.resolve(destDir) + path.sep))   // no "../" out of the section
      throw Object.assign(new Error(`Refusing ${e.filename}: it points outside its section.`), { status: 400 });
    const want = byPath.get(e.filename);
    if (!want) throw Object.assign(new Error(`${e.filename} is in the archive but not in its manifest.`), { status: 400 });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await e.getData(Writable.toWeb(fs.createWriteStream(dest, { mode: 0o600 })), password ? { password } : {});
    if (await sha256File(dest) !== want.sha256)
      throw Object.assign(new Error(`${e.filename} does not match its checksum — the backup is damaged.`), { status: 422 });
    if (want.mtime) try { const t = new Date(want.mtime); fs.utimesSync(dest, t, t); } catch {}
    count++;
  }
  return count;
}

module.exports = { FORMAT, FORMAT_VERSION, EXT, sections, inventory, create, open, peek, extractSection, fileName };
