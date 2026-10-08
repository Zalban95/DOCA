'use strict';

/**
 * The three measurements of `npm run experiment -- system-one` (bin/experiments/system-one.js): each returns rows
 * {decision, way, n, right, ms, notes} for the write-up's table, and prints each case as it goes.
 */
const cases = require('./system-one-cases');

const one = () => require('../../modules/system-one');
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const ask = (m, system, user) => require('../../modules/harness/turn/transport').ask({ system, user, provider: m.provider, model: m.model, temperature: 0, signal: AbortSignal.timeout(120e3) });
const name = m => `${m.provider}/${m.model}`;
const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];

/** "≥0.2: 9/12" for each threshold: of the answers at least that sure, how many were right. */
function sweep(results) {
  return THRESHOLDS.map(t => { const a = results.filter(r => r.conf >= t); return `≥${t}: ${a.filter(r => r.ok).length}/${a.length}`; }).join(', ');
}

/** "≥0.6: 19" for each threshold: how many the combined way gets right when Laya decides at that threshold. */
const combos = (n, at) => THRESHOLDS.map(t => `≥${t}: ${at(t)}/${n}`).join(', ');

async function triage({ models, timed }) {
  const triageJs = require('../../modules/harness/turn/triage');
  const { SIZE, PACE, asked } = require('../../modules/system-one/decisions');
  const list = cases.triage(), thr = one().settings().threshold;
  const L = [], M = models.map(() => []), R = [];
  for (const c of list) {
    const rules = triageJs.rate({ message: c.prompt });
    R.push({ ok: rules.difficulty === c.label, sure: rules.sure, got: rules.difficulty });
    const l = await timed(() => one().decide({ state: asked(c.prompt, false), questions: [SIZE, PACE] }));
    const a = l.v?.answers?.size;
    L.push({ ok: a?.choice === c.label, conf: a?.confidence ?? 0, got: a?.choice, ms: l.v?.ms ?? l.ms });
    for (const [i, m] of models.entries()) {
      const r = await timed(() => ask(m, triageJs.MODEL_PROMPT, c.prompt));
      const got = triageJs.parseModel(r.v)?.difficulty || null;
      M[i].push({ ok: got === c.label, got, ms: r.ms });
    }
    console.log(`triage ${c.set}/${c.id}: ${c.label} — rules ${rules.difficulty}${rules.sure ? '' : '?'}, laya ${a?.choice} ${(a?.confidence ?? 0).toFixed(2)}${M.map((x, i) => `, ${models[i].model} ${x[x.length - 1].got}`).join('')}`);
  }
  const n = list.length, unsure = R.filter(r => !r.sure).length;
  const comb = t => R.map((r, i) => (r.sure ? r.ok : L[i].conf >= t ? L[i].ok : r.ok)).filter(Boolean).length;
  const rows = [
    { decision: 'triage size', way: 'rules alone (today without a quick model)', n, right: R.filter(r => r.ok).length, ms: 0, notes: `rules unsure on ${unsure}: medium stands` },
    { decision: 'triage size', way: `rules, then Laya where unsure (≥${thr})`, n, right: comb(thr), ms: median(L.filter((_, i) => !R[i].sure).map(x => x.ms)), notes: `Laya sure on ${L.filter((x, i) => !R[i].sure && x.conf >= thr).length} of ${unsure}; by threshold ${combos(n, comb)}` },
    { decision: 'triage size', way: 'Laya alone, every case', n, right: L.filter(x => x.ok).length, ms: median(L.map(x => x.ms)), notes: sweep(L) },
  ];
  for (const [i, m] of models.entries()) {
    rows.push({ decision: 'triage size', way: `rules, then ${name(m)} where unsure (today with a quick model)`, n, right: R.map((r, j) => (r.sure ? r.ok : M[i][j].got ? M[i][j].ok : r.ok)).filter(Boolean).length, ms: median(M[i].filter((_, j) => !R[j].sure).map(x => x.ms)) });
    rows.push({ decision: 'triage size', way: `${name(m)} alone, every case`, n, right: M[i].filter(x => x.ok).length, ms: median(M[i].map(x => x.ms)) });
  }
  return rows;
}

async function front({ models, timed, FRONT_PROMPT }) {
  const frontJs = require('../../modules/harness/turn/front');
  const { ROUTE, asked } = require('../../modules/system-one/decisions');
  const thr = one().settings().threshold, voice = { name: 'measure', mode: 'assistant' };
  const L = [], M = models.map(() => []), R = [];
  for (const c of cases.FRONT) {
    const p = frontJs.plan({ client: voice, message: c.prompt });
    R.push({ ok: (p?.delegate ? 'later' : 'now') === c.label, deep: !!p?.deep });
    const l = await timed(() => one().decide({ state: asked(c.prompt, true), questions: [ROUTE] }));
    const a = l.v?.answers?.route;
    L.push({ ok: a?.choice === c.label, conf: a?.confidence ?? 0, got: a?.choice, ms: l.v?.ms ?? l.ms });
    for (const [i, m] of models.entries()) {
      const r = await timed(() => ask(m, FRONT_PROMPT, c.prompt));
      const got = (String(r.v || '').toLowerCase().match(/\b(now|later)\b/) || [])[1] || null;
      M[i].push({ ok: got === c.label, got, ms: r.ms });
    }
    console.log(`front "${c.prompt.slice(0, 50)}": ${c.label} — rules ${p?.delegate ? 'later' : 'now'}, laya ${a?.choice} ${(a?.confidence ?? 0).toFixed(2)}${M.map((x, i) => `, ${models[i].model} ${x[x.length - 1].got}`).join('')}`);
  }
  const n = cases.FRONT.length;
  const comb = t => R.map((r, i) => (r.deep ? r.ok : L[i].conf >= t ? L[i].ok : r.ok)).filter(Boolean).length;
  const rows = [
    { decision: 'call route', way: 'rules (today: hand on when the triage rules say large)', n, right: R.filter(r => r.ok).length, ms: 0 },
    { decision: 'call route', way: `Laya where sure (≥${thr}), else the rules`, n, right: comb(thr), ms: median(L.map(x => x.ms)), notes: `Laya sure on ${L.filter(x => x.conf >= thr).length} of ${n}; by threshold ${combos(n, comb)}` },
    { decision: 'call route', way: 'Laya alone', n, right: L.filter(x => x.ok).length, ms: median(L.map(x => x.ms)), notes: sweep(L) },
  ];
  for (const [i, m] of models.entries()) rows.push({ decision: 'call route', way: `${name(m)} alone (one completion)`, n, right: M[i].filter(x => x.ok).length, ms: median(M[i].map(x => x.ms)) });
  return rows;
}

async function browser({ models, timed, BROWSER_PROMPT }) {
  const b = require('../../modules/system-one/browser');
  const { pages, cases: list } = cases.browser();
  const L = [], M = models.map(() => []);
  for (const c of list) {
    const snap = pages[c.page];
    const elements = b.parse(snap).elements.length;
    const l = await timed(() => b.propose({ goal: c.goal, snapshot: snap }));
    const p = l.v, top = p?.choices || [];
    L.push({ ok: !!top[0] && c.answer.includes(top[0].ref), top3: top.some(x => c.answer.includes(x.ref)), conf: p?.confidence ?? 0,
      howKind: !!top[0] && top[0].how === c.how, ms: p?.ms ?? l.ms, err: l.err });
    for (const [i, m] of models.entries()) {
      const r = await timed(() => ask(m, BROWSER_PROMPT, `Goal: ${c.goal}\n\n${snap}`));
      const mm = String(r.v || '').match(/\[?(\d+)\]?\s*(click|type|scroll|done)?/i);
      M[i].push({ ok: !!mm && c.answer.includes(Number(mm[1])), how: (mm?.[2] || '').toLowerCase() === c.how, ms: r.ms });
    }
    console.log(`browser ${c.page} "${c.goal}" (${elements} elements): ${c.answer.join('|')} — laya ${top.slice(0, 3).map(x => `${x.ref} ${x.p.toFixed(2)}`).join(', ') || l.err} conf ${(p?.confidence ?? 0).toFixed(2)}${M.map((x, i) => `, ${models[i].model} ${x[x.length - 1].ok ? 'right' : 'wrong'}`).join('')}`);
  }
  const n = list.length, thr = one().settings().threshold, sure = L.filter(x => x.conf >= thr);
  const rows = [
    { decision: 'page next element', way: 'Laya, top choice', n, right: L.filter(x => x.ok).length, ms: median(L.map(x => x.ms)),
      notes: `in its top 3: ${L.filter(x => x.top3).length}/${n}; sure (≥${thr}) on ${sure.length}, right on ${sure.filter(x => x.ok).length}; ${sweep(L)}` },
    { decision: 'page how', way: 'from the chosen element\'s kind (field → type, else click)', n, right: L.filter(x => x.howKind).length, ms: 0 },
  ];
  for (const [i, m] of models.entries()) rows.push({ decision: 'page next element', way: `${name(m)}, one step reading the snapshot`, n, right: M[i].filter(x => x.ok).length, ms: median(M[i].map(x => x.ms)), notes: `how right: ${M[i].filter(x => x.how).length}/${n}` });
  return rows;
}

module.exports = { triage, front, browser, sweep };
