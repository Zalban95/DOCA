'use strict';

/**
 * A line diff for the Workstream (TODO H10.9): what an edit added and removed, as the hunks other coding harnesses show
 * (+69 −0). Myers' O(ND) algorithm over lines, with a ceiling on the work so a rewritten 20 000-line file costs a
 * bounded moment and is reported as replaced rather than diffed.
 */
const MAX_D = 2000;

/** The edit script from `a` to `b` (arrays of lines): [{op: ' '|'-'|'+', line}], or null past MAX_D differences. */
function script(a, b) {
  const n = a.length, m = b.length, max = Math.min(n + m, MAX_D), off = max + 1;
  const v = new Int32Array(2 * max + 3), trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, off, d);
    }
  }
  return null;
}

function backtrack(trace, a, b, off, d) {
  const out = [];
  let x = a.length, y = b.length;
  for (; d > 0; d--) {
    const v = trace[d], k = x - y;
    const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
    const px = v[off + prevK], py = px - prevK;
    while (x > px && y > py) { out.push({ op: ' ', line: a[--x] }); y--; }
    if (x === px) out.push({ op: '+', line: b[--y] }); else out.push({ op: '-', line: a[--x] });
  }
  while (x > 0 && y > 0) { out.push({ op: ' ', line: a[--x] }); y--; }
  return out.reverse();
}

/**
 * The change from `before` to `after` (texts): counts and hunks with `context` lines around each, each line numbered
 * in the new text (`n`; a removed line carries the number it would have had). Big or wholly rewritten files come back
 * `replaced` with counts only.
 */
function diff(before, after, { context = 3, maxLines = 400 } = {}) {
  const a = String(before ?? '').split('\n'), b = String(after ?? '').split('\n');
  if (before === '' || before == null) return { added: after ? b.length : 0, removed: 0, hunks: after ? [{ lines: b.slice(0, maxLines).map((line, i) => ({ op: '+', line, n: i + 1 })) }] : [], created: true };
  const ops = script(a, b);
  if (!ops) return { added: b.length, removed: a.length, hunks: [], replaced: true };
  let added = 0, removed = 0, n = 0;
  const numbered = ops.map(o => { if (o.op === '+') added++; if (o.op === '-') removed++; if (o.op !== '-') n++; return { ...o, n: o.op === '-' ? n + 1 : n }; });
  const hunks = [];
  let cur = null, sent = 0;
  numbered.forEach((o, i) => {
    if (o.op === ' ') return;
    const from = Math.max(0, i - context);
    if (cur && from <= cur.end + 1) cur.end = i;
    else { if (cur) hunks.push(cur); cur = { start: from, end: i }; }
  });
  if (cur) hunks.push(cur);
  const out = [];
  for (const h of hunks) {
    if (sent >= maxLines) break;
    const lines = numbered.slice(h.start, Math.min(numbered.length, h.end + context + 1)).slice(0, maxLines - sent);
    sent += lines.length;
    out.push({ lines });
  }
  return { added, removed, hunks: out };
}

module.exports = { diff, script };
