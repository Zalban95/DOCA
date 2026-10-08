'use strict';

/**
 * A GGUF on Hugging Face, as llama.cpp would run it: which files a repository offers (by quantization, split sets
 * together, the vision projector apart), read through the Hub's own API — never an address anyone typed. An install is
 * named `org/repo:<quant or file>` (installs.js kind `llamacpp-hf`); `resolve()` turns that into the exact files from
 * the repository's listing, so a name that is not there is refused with what is.
 *
 * The Hub is `DOCA_HF_ENDPOINT` (Hugging Face's own address by default; the tests' stub, or a mirror) and the token,
 * when the person kept one, is the protected one (hf-token.js) — sent only to that address.
 */
const ENDPOINT = () => (process.env.DOCA_HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const REPO = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;
// A quantization (IQ3_S, Q4_K_M, BF16) or a file of the repository (it may sit in a folder: IQ3_S/x-00001-of-00002.gguf).
const QUANT = /^[A-Za-z0-9][\w-]{0,40}$/;
const FILE = /^(?:[\w.+-]+\/){0,3}[\w.+-]+\.gguf$/i;
const SHARD = /-(\d{5})-of-(\d{5})\.gguf$/i;
// The quantization a file name carries, as llama.cpp's own tools write it.
const QUANT_IN_NAME = /[-_.]((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4(?:_[A-Z0-9]+)?|TQ\d_\d))(?:-\d{5}-of-\d{5})?\.gguf$/i;

/** `org/repo:spec` → {repo, spec}, or why not. Checked by shape only: what the repository has is resolve()'s. */
function parse(id) {
  const s = String(id || '').trim();
  const i = s.indexOf(':');
  const repo = i > 0 ? s.slice(0, i) : s, spec = i > 0 ? s.slice(i + 1) : '';
  if (!REPO.test(repo)) return { error: 'A Hugging Face model is named org/repo, like ornith-ai/Ornith-1.5-9B-GGUF.' };
  if (!spec) return { error: `Name the quantization or the file after the repository: ${repo}:Q4_K_M.` };
  if (spec.includes('..') || !(QUANT.test(spec) || FILE.test(spec))) return { error: `"${spec}" is neither a quantization (Q4_K_M, IQ3_S) nor a .gguf file of the repository.` };
  return { repo, spec };
}

function headers(url) {
  const h = { 'User-Agent': 'doca-panel', Accept: 'application/json' };
  const token = require('../hf-token').get();
  try { if (token && new URL(url).origin === new URL(ENDPOINT()).origin) h.Authorization = `Bearer ${token}`; } catch { /* no token sent */ }
  return h;
}

async function getJson(path, what) {
  const url = `${ENDPOINT()}${path}`;
  let r;
  try { r = await fetch(url, { headers: headers(url), signal: AbortSignal.timeout(15000) }); } catch (e) { throw bad(`Hugging Face did not answer (${e.message}).`, 502); }
  if (r.status === 401 || r.status === 403) throw bad(`${what} needs a Hugging Face token with access: accept its terms on huggingface.co, then keep a token in Field → Models → HuggingFace.`, 403);
  if (r.status === 404) throw bad(`${what} is not on Hugging Face (or is private).`, 404);
  if (!r.ok) throw bad(`Hugging Face answered HTTP ${r.status} for ${what}.`, 502);
  return r.json();
}

const quantOf = p => (QUANT_IN_NAME.exec(p.split('/').pop()) || [])[1]?.toUpperCase() || null;
const isMmproj = p => /^mmproj/i.test(p.split('/').pop());
const shardBase = p => p.replace(SHARD, '');

/** The repository's GGUF files: {path, size, sha256}. */
async function files(repo) {
  const tree = await getJson(`/api/models/${repo}/tree/main?recursive=1`, repo);
  return (Array.isArray(tree) ? tree : []).filter(f => f && f.type !== 'directory' && /\.gguf$/i.test(f.path || ''))
    .map(f => ({ path: f.path, size: Number(f.lfs?.size ?? f.size) || 0, sha256: f.lfs?.oid || f.lfs?.sha256 || null }));
}

/** What the Models tab lists: each quantization (a split set is one), the projectors, and the repository's facts. */
async function offer(repo) {
  if (!REPO.test(repo)) throw bad('A Hugging Face model is named org/repo.');
  const [list, info] = await Promise.all([files(repo), getJson(`/api/models/${repo}`, repo).catch(() => ({}))]);
  const sets = new Map();
  for (const f of list.filter(x => !isMmproj(x.path))) {
    const key = shardBase(f.path);
    if (!sets.has(key)) sets.set(key, { file: f.path, quant: quantOf(f.path), files: [], bytes: 0 });
    const s = sets.get(key); s.files.push(f); s.bytes += f.size;
    if (SHARD.test(f.path) && /-00001-of-/i.test(f.path)) s.file = f.path;
  }
  const quants = [...sets.values()].map(s => ({ ...s, parts: s.files.length })).sort((a, b) => a.bytes - b.bytes);
  return { repo, quants, mmproj: list.filter(x => isMmproj(x.path)), context: info.gguf?.context_length || null,
    architecture: info.gguf?.architecture || null, gated: !!info.gated, licence: info.cardData?.license || null };
}

/**
 * `org/repo:spec` → the exact files to download: the model (every part of a split set, all of them present), and the
 * vision projector when the repository has one and `vision` is not false.
 */
async function resolve(id, { vision = true } = {}) {
  const p = parse(id);
  if (p.error) throw bad(p.error);
  const o = await offer(p.repo);
  if (!o.quants.length) throw bad(`${p.repo} has no GGUF files.`);
  const want = p.spec.toUpperCase();
  const hits = FILE.test(p.spec)
    ? o.quants.filter(q => q.files.some(f => f.path === p.spec))
    : o.quants.filter(q => q.quant === want);
  const say = () => o.quants.map(q => `${q.quant || q.file} (${(q.bytes / 2 ** 30).toFixed(1)} GB)`).join(', ');
  if (!hits.length) throw bad(`${p.repo} has no ${p.spec}. It offers: ${say()}.`);
  if (hits.length > 1) throw bad(`${p.repo} has more than one ${p.spec}: ${hits.map(h => h.file).join(', ')} — name the file.`);
  const q = hits[0];
  const n = Number((SHARD.exec(q.file) || [])[2] || 1);
  if (q.files.length !== n) throw bad(`${p.repo}: ${q.file} is split in ${n} parts and ${q.files.length} are listed — the set is incomplete.`);
  q.files.sort((a, b) => a.path.localeCompare(b.path));
  const proj = vision === false || !o.mmproj.length ? null
    : o.mmproj.find(f => /[-_]F16\.gguf$/i.test(f.path)) || o.mmproj.find(f => /BF16/i.test(f.path)) || o.mmproj[0];
  return { repo: p.repo, quant: q.quant, file: q.file, files: q.files, mmproj: proj, bytes: q.bytes + (proj?.size || 0),
    modelBytes: q.bytes, context: o.context, architecture: o.architecture, hasVision: o.mmproj.length > 0 };
}

/** GGUF repositories matching words, most downloaded first. */
async function search(q) {
  const words = String(q || '').trim().slice(0, 100);
  if (!words) return [];
  const out = await getJson(`/api/models?search=${encodeURIComponent(words)}&filter=gguf&sort=downloads&direction=-1&limit=20`, `the search "${words}"`);
  return (Array.isArray(out) ? out : []).map(m => ({ id: m.id, downloads: m.downloads || 0, likes: m.likes || 0, updated: m.lastModified || null }));
}

/** The address a file is fetched from: the Hub's own `resolve` route for this repository, nothing else. */
const fileUrl = (repo, path) => `${ENDPOINT()}/${repo}/resolve/main/${path.split('/').map(encodeURIComponent).join('/')}`;

module.exports = { parse, offer, resolve, search, files, fileUrl, headers, quantOf, ENDPOINT, REPO };
