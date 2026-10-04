'use strict';

/**
 * Loose matching for the skills search (asked 2026-10-04: "doesn't have to be
 * a perfect match; search also in the description or important info"). The
 * first version scored a word only where it appeared verbatim, so "testing"
 * missed a skill about tests, a typo found nothing, and a word in a heading
 * counted no more than one in a footnote.
 *
 * A query word matches a text word when they are the same after stemming, one
 * is a prefix of the other (3+ letters), they are within one edit (two for
 * words of 7+ letters), or they are listed as meaning the same here. Where it
 * matches decides the weight: name 6, description 4, the skill's important
 * lines (headings, "use when" / "when to" lines, the first paragraph) 2, the
 * rest of the body 1 — best field per word, not every occurrence. A result
 * must match at least half the query's words, and covering more of them ranks
 * higher, so a long query is not won by the skill that repeats one word.
 */

const SYNONYMS = [
  ['test', 'check', 'verify', 'spec', 'qa'], ['deploy', 'release', 'ship', 'publish'], ['review', 'audit', 'inspect'],
  ['doc', 'docs', 'documentation', 'readme', 'document'], ['image', 'picture', 'photo', 'screenshot'],
  ['bug', 'debug', 'fix', 'error', 'issue'], ['commit', 'git', 'pr', 'pull'], ['build', 'compile'],
  ['pdf', 'document'], ['sheet', 'spreadsheet', 'excel', 'xlsx', 'csv'], ['slide', 'deck', 'presentation', 'pptx'],
  ['android', 'apk', 'gradle'], ['web', 'site', 'html', 'frontend'], ['data', 'dataset', 'database', 'sql'],
];

function stem(w) {
  // …then a final e, so merge/merging and invoice/invoices meet at merg and invoic.
  const s = w.replace(/(ations?|ings?|ers?|ies|ied|es|ed|ly|s)$/, m => (m === 'ies' || m === 'ied' ? 'y' : '')).replace(/e$/, '');
  return (s.length >= 2 ? s : w).slice(0, 24);
}

// Keyed by stem, so "slides" finds the slide/deck/presentation group as "slide" does.
const SYN = new Map();
for (const group of SYNONYMS) {
  const stems = group.map(stem);
  for (const s of stems) SYN.set(s, new Set([...(SYN.get(s) || []), ...stems]));
}

const words = text => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
// Words a request is wrapped in rather than about: "make slides" is a search for slides.
const FILLER = new Set(['make', 'use', 'do', 'get', 'want', 'need', 'help', 'how', 'what', 'please', 'my', 'me', 'the', 'for',
  'with', 'and', 'to', 'of', 'in', 'on', 'an', 'it', 'is', 'can', 'some', 'this', 'that', 'from', 'into', 'about']);

/** Edit distance at most `max`, a swap of two neighbouring letters counting as one (reveiw → review). */
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= max;
}

/** How well query word `q` matches a set of text words: 1 exact/stem, .8 synonym or prefix, .6 typo, 0 none. */
function wordScore(q, set) {
  if (set.has(q)) return 1;
  const qs = stem(q);
  let best = 0;
  for (const w of set) {
    if (stem(w) === qs) return 1;
    if (SYN.get(qs)?.has(stem(w))) best = Math.max(best, 0.8);
    else if (q.length >= 3 && (w.startsWith(q) || (w.length >= 3 && q.startsWith(w)))) best = Math.max(best, 0.8);
    else if (q.length >= 4 && within(q, w, q.length >= 7 ? 2 : 1)) best = Math.max(best, 0.6);
  }
  return best;
}

/** The lines of a skill body that say most about it. */
function important(body) {
  const lines = String(body || '').split('\n');
  const firstPara = [];
  for (const l of lines) { if (!l.trim()) { if (firstPara.length) break; continue; } if (!/^#/.test(l)) firstPara.push(l); }
  return [...lines.filter(l => /^#{1,4}\s/.test(l) || /\b(use (it |this )?when|when to use|use for|triggers?)\b/i.test(l)), ...firstPara].join(' ');
}

const WEIGHTS = { name: 6, description: 4, important: 2, body: 1 };

/** A function scoring { name, description, body } against `query`; 0 = not a result. */
function matcher(query) {
  const all = [...new Set(words(query))];
  const q = all.filter(w => !FILLER.has(w)).length ? all.filter(w => !FILLER.has(w)) : all;
  const phrase = String(query || '').toLowerCase().trim();
  return item => {
    if (!q.length) return 0;
    const fields = {
      name: new Set(words(String(item.name).replace(/[-_]/g, ' '))),
      description: new Set(words(item.description)),
      important: new Set(words(important(item.body))),
      body: new Set(words(item.body)),
    };
    let total = 0, hit = 0;
    for (const w of q) {
      let best = 0;
      for (const [f, set] of Object.entries(fields)) best = Math.max(best, wordScore(w, set) * WEIGHTS[f]);
      if (best > 0) { hit++; total += best; }
    }
    if (hit < Math.ceil(q.length / 2)) return 0;
    const bonus = phrase.length > 3 && `${item.name} ${item.description}`.toLowerCase().includes(phrase) ? 4 : 0;
    return +(total * (hit / q.length) + bonus).toFixed(2);
  };
}

module.exports = { matcher, wordScore, stem, important };
