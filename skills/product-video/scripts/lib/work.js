'use strict';

/**
 * Where a promo's frames are rendered: never beside the video. Round 1 (2026-10-16) left 499 MB of PNG frames in the
 * deliverables folder next to the MP4, where they were shipped, committed and copied with it. The frames are a re-cut
 * cache — a word changed re-cuts in seconds from them — so they live in the hub's data folder (`renders/`), one
 * folder per video, the newest KEEP kept; `work` in the spec, or DOCA_RENDER_CACHE, puts them elsewhere. Only the
 * video and its two small markers (<video>.status.json, <video>.done.json) sit beside it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEEP = 6;

/** The data folder: DOCA_DATA_DIR, else the `.doca` the hub keeps beside its code (this skill is shipped inside it). */
function dataDir() {
  if (process.env.DOCA_DATA_DIR) return process.env.DOCA_DATA_DIR;
  for (let d = __dirname, i = 0; i < 8; i++, d = path.dirname(d)) {
    const c = path.join(d, '.doca');
    try { if (fs.statSync(c).isDirectory()) return c; } catch { /* not here */ }
  }
  return null;
}

/** The folder renders are cached in: not hidden at the top of the home folder, where a snap cannot write. */
function root() {
  if (process.env.DOCA_RENDER_CACHE) return process.env.DOCA_RENDER_CACHE;
  const data = dataDir();
  return data ? path.join(data, 'renders') : path.join(os.homedir(), 'doca-renders');
}

/** This video's work folder: the spec's own `work` (resolved by the caller), else one named after the video. */
function dirFor(spec) {
  if (spec.work) return spec.work;
  const name = path.basename(spec.out).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60);
  return path.join(root(), `${name}-${crypto.createHash('sha256').update(spec.out).digest('hex').slice(0, 10)}`);
}

/** Keep the newest KEEP render folders under the shared root (never one a spec named itself), oldest removed first. */
function prune(keep = KEEP) {
  const r = root();
  let ents = [];
  try { ents = fs.readdirSync(r, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(r, e.name)); } catch { return []; }
  const aged = ents.map(d => { try { return [d, fs.statSync(d).mtimeMs]; } catch { return [d, 0]; } }).sort((a, b) => b[1] - a[1]);
  const gone = aged.slice(keep).map(([d]) => d);
  for (const d of gone) fs.rmSync(d, { recursive: true, force: true });
  return gone;
}

module.exports = { dirFor, root, prune, dataDir, KEEP };
