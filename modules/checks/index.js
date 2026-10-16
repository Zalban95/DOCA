'use strict';

/**
 * Mechanical checks of a piece of work (TODO, improvement B, 2026-10-16): a video, a PDF, a 3D model or a picture,
 * read the way a person would look at it and held to what the plan asked — so "done" means done for a cheap model too.
 * A contract's check (harness/plan-contracts.js) and the agent's own `check_output` both come here:
 *   { video, duration?, width?, height?, fps?, frames? }     checks/video.js
 *   { pdf, pages?, contains?, noOverlap? }                    checks/pdf.js
 *   { mesh, maxSize?: [x, y, z], watertight?, minParts? }     checks/mesh.js
 *   { image, notBlank?, contains?, width?, height? }          checks/image.js
 * Each answers { ok, why }: what failed and where (the second, the page and the place on it, the edge count), and what it
 * could not verify — a program that is missing is named, never passed over in silence. A requirement the contract asked
 * for that could not be verified does not hold: it fails, saying what to install (checks/verdict.js, the one rule). Every reader runs a program the
 * hub knows by argv (checks/bin.js) on a file under the allowed roots; nothing here runs a command the agent wrote, and
 * no model reads the file.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const KINDS = { video: './video', pdf: './pdf', mesh: './mesh', image: './image' };
const kind = c => Object.keys(KINDS).find(k => c && typeof c[k] === 'string' && c[k].trim()) || null;
const reader = k => require(KINDS[k]);
const badDefault = m => Object.assign(new Error(m), { status: 400 });

/** The check as stored: its kind's fields only, each in range; throws a 400 naming what is wrong. */
function normalize(c, bad = badDefault) {
  const k = kind(c);
  if (!k) throw bad(`A check of a piece of work names one file: ${Object.keys(KINDS).join(', ')}.`);
  return reader(k).normalize(c, bad);
}

/** Where a check's file is: relative to the work's folder, ~ for home, and only inside the allowed roots. */
function where(p, cwd) {
  const abs = path.resolve(cwd || require('../harness/toolbox/common').workspace(), String(p).replace(/^~(?=$|[\\/])/, os.homedir()));
  if (!require('../utils').fmSafe(abs)) return { abs, refused: `${abs} is outside the folders a check may read` };
  try { if (require('../harness/secret-view').kindOf(abs)) return { abs, refused: `${abs} holds settings or secrets, not a piece of work` }; } catch { /* the view is a nicety here */ }
  return { abs };
}

/** { ok, why }: the check held now, or what is wrong with the file, with where. */
async function run(c, { cwd } = {}) {
  const k = kind(c);
  if (!k) return { ok: false, why: 'not a check of a piece of work' };
  const file = c[k], { abs, refused } = where(file, cwd);
  if (refused) return { ok: false, why: refused };
  let st;
  try { st = fs.statSync(abs); } catch { return { ok: false, why: `${file} is not there` }; }
  if (!st.isFile()) return { ok: false, why: `${file} is not a file` };
  if (!st.size) return { ok: false, why: `${file} is empty` };
  try {
    const r = await reader(k).check(c, abs);
    return { ok: !!r.ok, why: `${path.basename(abs)}: ${r.why}` };
  } catch (e) { return { ok: false, why: `${path.basename(abs)} could not be checked: ${e.message}` }; }
}

module.exports = { KINDS: Object.keys(KINDS), kind, normalize, run, where };
