'use strict';

/**
 * This install's own additions to the suggested models (docs/design/model-suggestions.md): entries a person accepted
 * from the model scout (a suggestion of kind `suggested-model`, Settings → Harness → Scout). They are kept in the store
 * (`guided/suggestions-local`), never in the shipped file, and laid over whichever list is in use — the shipped one, or
 * a newer one received from the project's hub — by suggestions.js: an entry with the role and id of one in the list
 * replaces it, any other is added. Nothing gets here without a person's click, and forgetting one is a click too.
 *
 * An entry is checked whole before it is kept: the shape the picker reads, sources a person can open, and an install
 * that is a model pull or one of the panel's services — the same installers a button in the panel runs, through an
 * install proposal that still waits for its own click.
 */
const store = require('../store');

const DOC = 'guided/suggestions-local';
const ROLES = ['chat', 'coding', 'vision', 'embeddings', 'stt', 'tts'];
const KINDS = ['ollama-model', 'service'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const num = (v, max) => Number.isFinite(v) && v >= 0 && v <= max;
const text = (v, n) => String(v ?? '').trim().slice(0, n);

/** A clean copy of a suggested entry, or the reason it is refused. Only known fields are kept. */
function clean(e, role) {
  if (!e || typeof e !== 'object') return { why: 'An entry is an object with the fields of the suggestions list.' };
  const r = role || e.role;
  if (!ROLES.includes(r)) return { why: `role is one of ${ROLES.join(', ')}.` };
  const id = text(e.id, 160);
  if (!/^[\w.:/@+-]{1,160}$/.test(id)) return { why: 'id names the model: letters, digits and . : / _ - only.' };
  const n = e.needs || {};
  if (!num(n.vramGB, 1024) || !num(n.ramGB, 4096) || (n.diskGB != null && !num(n.diskGB, 8192)))
    return { why: 'needs gives vramGB and ramGB (and diskGB) in GB, measured or computed from the file size plus its context.' };
  const kind = e.install?.kind, target = text(e.install?.id, 160);
  if (!KINDS.includes(kind)) return { why: `install.kind is ${KINDS.join(' or ')}: a model pull or one of the panel's services.` };
  let bad = null;
  try { bad = require('../harness/installs').KINDS[kind].validate(target); } catch (err) { bad = err.message; }
  if (bad) return { why: `install.id: ${bad}` };
  const sources = (Array.isArray(e.sources) ? e.sources : []).map(s => (typeof s === 'string' ? { url: s } : s))
    .filter(s => s && /^https:\/\/[^\s"<>]+$/.test(String(s.url || ''))).slice(0, 12)
    .map(s => ({ url: text(s.url, 400), checked: DAY.test(s.checked) ? s.checked : new Date().toISOString().slice(0, 10) }));
  if (!sources.length) return { why: 'sources: at least one https address a person can open (a model card, a benchmark, a release).' };
  const out = {
    role: r, id, label: text(e.label || id, 120), quant: text(e.quant, 60), released: DAY.test(e.released) ? e.released : '',
    rank: num(e.rank, 100) ? e.rank : 0,
    needs: { vramGB: n.vramGB, ramGB: n.ramGB, diskGB: n.diskGB ?? null },
    install: { kind, id: target }, runtime: kind === 'service' ? 'docker' : 'ollama', sources,
  };
  if (e.cpuOk === true) out.cpuOk = true;
  if (e.context && num(e.context.native, 1e8)) out.context = { native: e.context.native, at: num(e.context.at, 1e8) ? e.context.at : null };
  if (e.gguf?.repo && e.gguf?.file) out.gguf = { repo: text(e.gguf.repo, 160), file: text(e.gguf.file, 200) };
  for (const k of ['licence', 'toolCalling']) if (e[k]) out[k] = text(e[k], k === 'licence' ? 60 : 600);
  const also = (Array.isArray(e.alsoFor) ? e.alsoFor : []).filter(x => ROLES.includes(x) && x !== r);
  if (also.length) out.alsoFor = [...new Set(also)];
  return { entry: out };
}

function list() {
  const d = store.readJson(DOC, null);
  return Array.isArray(d?.entries) ? d.entries.filter(e => !clean(e).why) : [];
}

/** Keep one accepted entry (replacing an earlier one for the same role and id). `from` is the suggestion it came from. */
function add(e, { from = null, by = null } = {}) {
  const c = clean(e);
  if (c.why) throw Object.assign(new Error(c.why), { status: 400 });
  const entry = { ...c.entry, from, by, acceptedAt: new Date().toISOString() };
  const rest = list().filter(x => !(x.role === entry.role && x.id === entry.id));
  store.writeJson(DOC, { entries: [...rest, entry] });
  return entry;
}

/** Forget one: the list goes back to what it was without it. */
function forget(role, id) {
  const all = list(), rest = all.filter(x => !(x.role === role && x.id === id));
  if (rest.length === all.length) throw Object.assign(new Error('No such accepted suggestion.'), { status: 404 });
  store.writeJson(DOC, { entries: rest });
  return { ok: true, left: rest.length };
}

/** The day the newest entry was checked: the latest source date. */
function checked(entries = list()) {
  return entries.flatMap(e => e.sources.map(s => s.checked)).sort().pop() || null;
}

module.exports = { clean, list, add, forget, checked, ROLES, KINDS, DOC };
