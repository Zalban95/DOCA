'use strict';

/**
 * Finding files in the Library (docs/experiments/library.md). Who may search what is decided here and nowhere else:
 * a host every chosen folder, anyone else only the folders the owner opened to everyone (`library.open`) — so a
 * person's search, the agent's `library_search` on their turn and a file opened from a result all answer to one rule.
 *
 * A query is embedded with the card's query prefix and compared with every piece the person may see; each file keeps
 * its best piece (for sound and video, the moment it matched). That ranking is merged by reciprocal rank with a
 * keyword one over the words kept — transcripts, document text, captions, tags and the file's own description — so a
 * word said in a recording still wins when the person uses it, and a picture is found when they describe it.
 */
const path = require('path');
const S = require('./store');
const E = require('./embed');

const sc = () => require('../settings-schema');
const isHost = person => !person?.id || require('../harness/session-access').isHost(person);

/** The folders `person` may search: [abs paths]. */
function foldersFor(person) {
  const all = (sc().value('library.folders') || []).map(f => path.resolve(f));
  if (isHost(person)) return all;
  const open = new Set((sc().value('library.open') || []).map(f => path.resolve(f)));
  return all.filter(f => open.has(f));
}

const inside = (p, dirs) => dirs.some(d => p === d || p.startsWith(d + path.sep));

/** May `person` open this indexed file? (Its row must exist: the Library serves only what it indexed.) */
async function mayOpen(person, p) {
  if (!require('../experiments').on('library')) return null;
  const abs = path.resolve(String(p || ''));
  if (!inside(abs, foldersFor(person))) return null;
  if (!require('../utils').fmSafe(abs)) return null;
  return S.item(abs);
}

// Pieces compared with a text query score by family: text with text sits above text with a picture or a sound (the
// model's modality gap). Each family's scores are taken relative to its own mean over the candidates before the best
// piece per file is chosen. Measured on the labelled set (first place, 28 queries, with transcripts): raw cosine 22,
// z-scores 19 (a family's best is lifted however far it is), offset from the mean 24.
const FAMILY = { text: 'text', transcript: 'text', caption: 'text', image: 'picture', frame: 'picture', audio: 'sound' };
function bestByFile(rows, qv) {
  const dot = require('./tags').dot, scored = rows.map(r => ({ r, s: dot(qv, r.vec), f: FAMILY[r.kind] || r.kind }));
  const stat = {};
  for (const x of scored) { const t = (stat[x.f] ||= { n: 0, sum: 0 }); t.n++; t.sum += x.s; }
  for (const t of Object.values(stat)) t.mean = t.sum / t.n;
  const best = new Map();
  for (const { r, s, f } of scored) {
    const z = stat[f].n > 1 ? s - stat[f].mean : 0;
    if (!best.has(r.path) || best.get(r.path).z < z) best.set(r.path, { score: s, z, piece: r });
  }
  return best;
}

// The keyword half counts only words that say something: "a", "the", "where" match every text and would rank the
// documents above every picture and recording (measured on the labelled set).
const STOP = new Set(('the and for with that this from what when where which who how are was were has have had not but you your our '
  + 'about into onto over under any all one some its it\'s there their them they his her him she file files find show audio video photo picture '
  + 'image voice note says said del della dei delle che per con una uno gli nel sul come dove quando quale sono').split(' '));
// Whole words, so "voice" does not match "invoice".
const tokens = t => new Set(String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u));
const words = q => String(q || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !STOP.has(w));

/**
 * Files nearest to `query`: [{path, kind, score, match: {kind, at, end, text}, about, tags, caption, meta}], best first.
 * `kinds` narrows (documents, images, audio, video); `folder` narrows to one folder the person may search.
 */
async function search(person, query, { kinds = null, folder = null, tags = null, limit = 10, signal } = {}) {
  if (!require('../experiments').on('library')) throw Object.assign(new Error('The Library experiment is off (Settings → Developer).'), { status: 409 });
  const cfg = E.settings();
  let dirs = foldersFor(person);
  if (folder) { const f = path.resolve(folder); dirs = dirs.filter(d => inside(f, [d]) || inside(d, [f])).map(d => (inside(f, [d]) ? f : d)); }
  if (!dirs.length) return { results: [], note: isHost(person) ? 'No folder is indexed yet (Field → Models → Library).' : 'No Library folder is open to you.' };
  const items = new Map((await S.items()).filter(i => inside(i.path, dirs) && (!kinds?.length || kinds.includes(i.kind))
    && (!tags?.length || tags.every(t => (i.meta.tags || []).some(x => x.tag === t)))).map(i => [i.path, i]));
  if (!items.size) return { results: [], note: 'Nothing indexed matches.' };
  const qv = await E.query(query, cfg, signal);
  const best = bestByFile((await S.vectors(cfg.model)).filter(r => items.has(r.path)), qv);
  const semantic = [...best.entries()].sort((a, b) => b[1].z - a[1].z).map(([p]) => p);
  const want = words(query);
  const kw = new Map();
  if (want.length) {
    for (const r of await S.vectors(cfg.model)) {
      if (!items.has(r.path) || !r.text) continue;
      const t = tokens(r.text), hit = want.filter(w => t.has(w)).length;
      if (hit && (!kw.has(r.path) || kw.get(r.path).hit < hit)) kw.set(r.path, { hit, piece: r });
    }
    for (const it of items.values()) {
      const t = tokens(`${it.meta.about || ''} ${(it.meta.tags || []).map(x => x.tag).join(' ')} ${it.meta.caption || ''}`);
      const hit = want.filter(w => t.has(w)).length;
      if (hit && (!kw.has(it.path) || kw.get(it.path).hit < hit)) kw.set(it.path, { hit, piece: kw.get(it.path)?.piece || null });
    }
  }
  const keyword = [...kw.entries()].sort((a, b) => b[1].hit - a[1].hit).map(([p]) => p);
  const order = require('../retrieval').hybrid(semantic, keyword).slice(0, Math.min(50, Math.max(1, limit)));
  const results = order.map(p => {
    const it = items.get(p), b = best.get(p), k = kw.get(p);
    const piece = (k?.piece && (!b || k.hit >= want.length)) ? k.piece : b?.piece;
    return { path: p, name: path.basename(p), kind: it.kind, score: b ? Math.round(b.score * 1000) / 1000 : null,
      match: piece ? { kind: piece.kind, at: piece.at, end: piece.end, text: piece.text ? piece.text.slice(0, 300) : null } : null,
      about: it.meta.about || path.basename(p), tags: it.meta.tags || [], caption: it.meta.caption || null,
      meta: { duration: it.meta.duration ?? null, width: it.meta.width ?? null, height: it.meta.height ?? null, peaks: it.meta.peaks || null } };
  });
  return { results, model: cfg.model };
}

/** Files like this one (near-duplicates first): its pieces' mean vector against every other file's best piece. */
async function similar(person, p, { limit = 10 } = {}) {
  const it = await mayOpen(person, p);
  if (!it) throw Object.assign(new Error('Not a file of the Library you may open.'), { status: 404 });
  const cfg = E.settings(), dirs = foldersFor(person);
  const mine = (await S.piecesOf(it.path, cfg.model)).filter(x => x.kind !== 'caption');
  if (!mine.length) return { results: [] };
  const mean = require('./tags').unit(mine[0].vec.map((_, i) => mine.reduce((s, x) => s + x.vec[i], 0) / mine.length));
  const best = new Map([...bestByFile((await S.vectors(cfg.model)).filter(r => r.path !== it.path && inside(r.path, dirs) && r.kind !== 'caption'), mean)]
    .map(([q, b]) => [q, b.score]));
  const all = new Map((await S.items()).map(i => [i.path, i]));
  return { results: [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).filter(([q]) => all.has(q)).map(([q, score]) => ({
    path: q, name: path.basename(q), kind: all.get(q).kind, score: Math.round(score * 1000) / 1000, near: score > 0.95,
    about: all.get(q).meta.about || path.basename(q), tags: all.get(q).meta.tags || [] })) };
}

module.exports = { foldersFor, mayOpen, search, similar, isHost };
