'use strict';

/**
 * /api/backups — Settings → Backups.
 *
 * Backups live in BACKUP_DIR (default `<DOCA_HOME>/backups`) and are addressed
 * by file name only; anything that is not a bare `*.dBac` name is refused, so no
 * route here reads or writes outside that directory.
 */
const fs   = require('fs');
const path = require('path');

const { BACKUP_DIR } = require('../paths');
const archive = require('./archive');
const restorer = require('./restore');
const secret  = require('./secret');

const NAME = /^[A-Za-z0-9._-]+\.dBac$/;

function fileOf(name) {
  if (!NAME.test(String(name || ''))) throw Object.assign(new Error('Not a backup name.'), { status: 400 });
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw Object.assign(new Error(`No backup called ${name}.`), { status: 404 });
  return file;
}

const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, code: e.code });

async function handleList(_req, res) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backups = [];
    for (const name of fs.readdirSync(BACKUP_DIR).filter(n => NAME.test(n))) {
      const file = path.join(BACKUP_DIR, name), st = fs.statSync(file);
      let info = { encrypted: null, files: null, valid: false };
      try { info = await archive.peek(file); } catch {}
      backups.push({ name, bytes: st.size, at: st.mtime.toISOString(), ...info });
    }
    backups.sort((a, b) => b.at.localeCompare(a.at));
    const inv = archive.inventory();
    let bytes = 0;
    for (const f of inv) try { bytes += fs.statSync(f.abs).size; } catch {}
    res.json({ dir: BACKUP_DIR, settings: secret.settings(), backups, estimate: { files: inv.length, bytes } });
  } catch (e) { fail(res, e); }
}

/** { encrypt?: boolean, password?: string, forget?: true } */
function handleSettings(req, res) {
  try {
    const b = req.body || {};
    if (typeof b.encrypt === 'boolean') secret.setEncrypt(b.encrypt);
    if (b.forget) secret.forget();
    if (b.password) secret.save(b.password);
    res.json(secret.settings());
  } catch (e) { fail(res, e); }
}

/** POST { password? } — make one now. */
async function handleCreate(req, res) {
  try {
    res.json(await archive.create({ password: secret.passwordFor(req.body?.password) }));
  } catch (e) { fail(res, e); }
}

function handleDownload(req, res) {
  try {
    const file = fileOf(req.params.name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    fs.createReadStream(file).pipe(res);
  } catch (e) { fail(res, e); }
}

/** POST ?name=x.dBac, the file as the raw body — a backup from another machine. */
/**
 * How big an upload may be: what the disk can take while leaving 2 GB free,
 * and at most DOCA_BACKUP_UPLOAD_MAX bytes when that is set. A backup holds
 * attachments, so there is no small fixed number that fits everyone; a full
 * disk is what this prevents.
 */
const DISK_MARGIN = 2 * 1024 ** 3;
function uploadLimit() {
  let free = Infinity;
  try { const st = fs.statfsSync(BACKUP_DIR); free = st.bavail * st.bsize - DISK_MARGIN; } catch { /* no statfs: the env cap only */ }
  const cap = Number(process.env.DOCA_BACKUP_UPLOAD_MAX) || Infinity;
  return Math.max(0, Math.min(free, cap));
}
const gb = n => `${(n / 1024 ** 3).toFixed(1)} GB`;
const tooBig = limit => Object.assign(new Error(`That file is larger than this machine can take now (${gb(limit)}, keeping 2 GB free).`), { status: 413 });

function handleUpload(req, res) {
  const name = String(req.query.name || '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!NAME.test(name)) return fail(res, Object.assign(new Error('Upload a .dBac file.'), { status: 400 }));
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, name);
  if (fs.existsSync(file)) return fail(res, Object.assign(new Error(`${name} is already here.`), { status: 409 }));
  const limit = uploadLimit();
  const declared = Number(req.headers['content-length']) || 0;
  if (declared > limit) return fail(res, tooBig(limit));
  const partial = `${file}.partial`;
  const out = fs.createWriteStream(partial, { mode: 0o600 });
  // Counted as it arrives too: a sender can leave the length out, or lie.
  let bytes = 0, over = false;
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > limit && !over) {
      over = true;
      req.unpipe(out); out.destroy();
      fs.rmSync(partial, { force: true });
      res.setHeader('Connection', 'close');   // the rest is read and dropped, then the connection ends
      fail(res, tooBig(limit));
      req.resume();
    }
  });
  req.pipe(out);
  out.on('finish', async () => {
    if (over) return;
    try {
      const info = await archive.peek(partial);
      if (!info.valid) throw Object.assign(new Error('That file is not a DOCA backup.'), { status: 400 });
      fs.renameSync(partial, file);
      res.json({ name, bytes: fs.statSync(file).size, ...info });
    } catch (e) {
      fs.rmSync(partial, { force: true });
      fail(res, e.status ? e : Object.assign(new Error('That file is not a DOCA backup.'), { status: 400 }));
    }
  });
  out.on('error', e => fail(res, e));
}

/** POST { password? } — what a restore would do. */
async function handlePlan(req, res) {
  try { res.json(await restorer.plan(fileOf(req.params.name), req.body?.password || null)); }
  catch (e) { fail(res, e); }
}

/** POST { password? } — streamed, then the panel restarts to read what was restored. */
async function handleRestore(req, res) {
  let file;
  try { file = fileOf(req.params.name); } catch (e) { return fail(res, e); }
  const { sseHeaders } = require('../utils');
  sseHeaders(res);
  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };
  const say = status => send({ status });
  const password = req.body?.password || null;
  try {
    // The safety copy of what is here now: with the password typed for this
    // restore, else the remembered one, else open — and it says so.
    const safetyPassword = password || secret.saved();
    if (!safetyPassword) say('Note: no password is available, so the safety backup of the current state is not encrypted.\n');
    const r = await restorer.restore(file, {
      password, say,
      safety: () => archive.create({ password: safetyPassword, name: archive.fileName().replace(/\.dBac$/, '-before-restore.dBac') }),
    });
    send({ done: true, ok: true, restarting: true, ...r, status: '\n✓ Restored. Restarting DOCA to read it…\n' });
    res.end();
    setTimeout(() => require('../releases').restartSelf(), 500);
  } catch (e) {
    send({ done: true, ok: false, code: e.code, status: `\n✗ ${e.message}\n` });
    res.end();
  }
}

function handleDelete(req, res) {
  try { fs.rmSync(fileOf(req.params.name)); res.json({ ok: true }); }
  catch (e) { fail(res, e); }
}

function mount(app) {
  app.get   ('/api/backups',                 handleList);
  app.post  ('/api/backups',                 handleCreate);
  app.post  ('/api/backups/settings',        handleSettings);
  app.post  ('/api/backups/upload',          handleUpload);
  app.get   ('/api/backups/:name/download',  handleDownload);
  app.post  ('/api/backups/:name/plan',      handlePlan);
  app.post  ('/api/backups/:name/restore',   handleRestore);
  app.delete('/api/backups/:name',           handleDelete);
}

module.exports = { mount, NAME };
