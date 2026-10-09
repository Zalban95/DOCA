'use strict';

/**
 * Tags without a writing model (docs/experiments/library.md, "Tags"): an embedding model cannot write a sentence, but
 * it can say which of a fixed list of phrases a picture or a sound is nearest to. The vocabulary (tags.json, extended
 * by `library.tags`) is embedded once per model and kept in memory; a file's tags are those whose phrase scores a
 * margin above the file's average over the vocabulary — a relative test, because each model's cosines sit at its own
 * level. Mechanical: the same file and list always give the same tags, with their scores, and nothing is worded by a
 * model.
 */
const E = require('./embed');

const VOCAB = require('./tags.json');
const MAX_TAGS = 5;
let _cache = null;   // {model, key, list: [{tag, group, for, vec}]}

/** The vocabulary in effect: shipped groups plus the owner's own tags (compared with every kind of piece). */
function vocabulary(own = require('../settings-schema').value('library.tags')) {
  const list = VOCAB.groups.flatMap(g => g.tags.map(t => ({ tag: t.tag, say: t.say, group: g.id, for: g.for })));
  for (const t of own || []) {
    const tag = String(t || '').trim().slice(0, 40);
    if (tag && !list.some(x => x.tag === tag)) list.push({ tag, say: tag, group: 'yours', for: ['picture', 'sound', 'text'] });
  }
  return list;
}

/** The vocabulary's vectors for this model (embedded once, as queries: a tag is asked of the file). */
async function vectors(cfg = E.settings(), signal) {
  const list = vocabulary();
  const key = `${cfg.provider}/${cfg.model}/${list.map(t => t.tag).join(',')}`;
  if (_cache?.key === key) return _cache.list;
  const vecs = await E.embed(list.map(t => ({ text: E.prefixOf(cfg.model).query + t.say })), cfg, signal);
  _cache = { key, list: list.map((t, i) => ({ ...t, vec: vecs[i] })) };
  return _cache.list;
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]; return s; };
const unit = v => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map(x => x / n); };
// Which tag families a piece is compared with.
const familyOf = kind => (kind === 'image' || kind === 'frame' ? 'picture' : kind === 'audio' ? 'sound' : kind === 'text' ? 'text' : null);

/**
 * Tags for one file from its pieces' vectors ([{kind, vec}]): [{tag, group, score}], best first. Per family, a tag
 * scores its best piece; it is kept when that is `margin` above the family's mean and among the first MAX_TAGS.
 */
function label(pieces, vocab, margin = require('../settings-schema').value('library.tagMargin')) {
  const out = [];
  for (const fam of ['picture', 'sound', 'text']) {
    const mine = pieces.filter(p => familyOf(p.kind) === fam && p.vec);
    const tags = vocab.filter(t => t.for.includes(fam));
    if (!mine.length || !tags.length) continue;
    const scored = tags.map(t => ({ tag: t.tag, group: t.group, score: Math.max(...mine.map(p => dot(p.vec, t.vec))) }));
    const mean = scored.reduce((a, b) => a + b.score, 0) / scored.length;
    out.push(...scored.filter(s => s.score >= mean + margin));
  }
  const best = new Map();
  for (const s of out.sort((a, b) => b.score - a.score)) if (!best.has(s.tag)) best.set(s.tag, { ...s, score: Math.round(s.score * 1000) / 1000 });
  return [...best.values()].slice(0, MAX_TAGS);
}

module.exports = { vocabulary, vectors, label, unit, dot, familyOf, MAX_TAGS, _reset: () => { _cache = null; } };
