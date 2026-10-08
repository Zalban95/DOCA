'use strict';

/**
 * Bringing a GGUF's files down from Hugging Face into the models folder, in Node (no Python, so it works wherever the
 * panel does): one file at a time into `<name>.part`, carried on from where it stopped when it is asked again (a
 * Range request), checked against the sha256 the Hub lists for it, then renamed — so a file with its final name is
 * always whole. The token goes only to the Hub's own address: a redirect to its storage is followed without it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hub = require('./hub');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const GB = 2 ** 30;

/** Where a repository's files go: `<dir>/<org>--<repo>/<path in the repo>`, never outside it. */
function target(dir, repo, file) {
  const root = path.resolve(dir, repo.replace('/', '--'));
  const out = path.resolve(root, ...file.split('/'));
  if (!out.startsWith(root + path.sep)) throw bad(`Refused a file outside the models folder: ${file}`);
  return out;
}

/** GET with the Hub's headers on the Hub, none elsewhere; redirects followed by hand so the token never travels. */
async function open(url, { from = 0, signal } = {}) {
  for (let hop = 0; hop < 6; hop++) {
    const h = hub.headers(url);
    delete h.Accept;
    if (from) h.Range = `bytes=${from}-`;
    const r = await fetch(url, { headers: h, redirect: 'manual', signal });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).toString(); continue; }
    return r;
  }
  throw bad('Too many redirects from Hugging Face.', 502);
}

/** The sha256 of what is already in a file (to carry on a check after a resume). */
function hashSoFar(file, hash) {
  return new Promise((ok, no) => fs.createReadStream(file).on('data', c => hash.update(c)).on('end', ok).on('error', no));
}

/** One file: returns its path. `progress(done, total)` is called as bytes arrive. */
async function one(dir, repo, f, { progress = () => {}, signal } = {}) {
  const out = target(dir, repo, f.path);
  try { if (fs.statSync(out).size === f.size && f.size) { progress(f.size, f.size); return out; } } catch { /* not here yet */ }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const part = `${out}.part`;
  let have = 0;
  try { have = fs.statSync(part).size; } catch { /* a fresh start */ }
  if (f.size && have > f.size) { fs.rmSync(part, { force: true }); have = 0; }
  const hash = crypto.createHash('sha256');
  const r = await open(hub.fileUrl(repo, f.path), { from: have, signal });
  if (r.status === 401 || r.status === 403) throw bad(`${repo} needs a Hugging Face token with access (Field → Models → HuggingFace).`, 403);
  if (!(r.ok || r.status === 206)) throw bad(`Hugging Face answered HTTP ${r.status} for ${f.path}.`, 502);
  if (have && r.status === 206) await hashSoFar(part, hash);
  else have = 0;   // the server sent it whole: start the file again
  const ws = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
  let done = have, cut = null;
  try {
    for await (const chunk of r.body) {
      hash.update(chunk);
      done += chunk.length;
      if (!ws.write(chunk)) await new Promise(ok => ws.once('drain', ok));
      progress(done, f.size || done);
    }
  } catch (e) { if (signal?.aborted) throw e; cut = e; }   // the connection dropped: what arrived is kept for next time
  finally { await new Promise(ok => ws.end(ok)); }
  if (cut || (f.size && done !== f.size)) throw bad(`${f.path} stopped at ${(done / GB).toFixed(2)} of ${(f.size / GB).toFixed(2)} GB — install again to carry on.`, 502);
  if (f.sha256 && hash.digest('hex') !== f.sha256) { fs.rmSync(part, { force: true }); throw bad(`${f.path} did not match the checksum Hugging Face lists — removed; install again.`, 502); }
  fs.renameSync(part, out);
  return out;
}

/**
 * Every file in order. `say(text)` gets a line per file and a progress line every few seconds; returns the paths in
 * the order given (the first part of a split set first — llama.cpp is pointed at it and finds the rest).
 */
async function all(dir, repo, list, { say = () => {}, signal } = {}) {
  const paths = [];
  for (const f of list) {
    say(`↓ ${f.path} (${(f.size / GB).toFixed(2)} GB)\n`);
    let last = 0;
    paths.push(await one(dir, repo, f, { signal, progress: (d, t) => {
      if (Date.now() - last < 3000 && d < t) return;
      last = Date.now();
      say(`  ${(d / GB).toFixed(2)} of ${(t / GB).toFixed(2)} GB (${Math.floor(d / t * 100)}%)\n`);
    } }));
  }
  return paths;
}

module.exports = { all, one, target };
