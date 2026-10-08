'use strict';

/**
 * The next step on a computer's page, proposed by the System 1 model (experiment `systemOne`; the tool
 * `computer_next`). Its input is text: the goal, and `browser_snapshot`'s numbered elements with the page's title,
 * address. It answers which element to act on, with probabilities, and the element's kind says how (a field is typed
 * into, the rest clicked: asked as a question of its own, "click, type, scroll or done" was right 3 times in 33 — see the
 * write-up) — and nothing else: the agent reads the proposal and acts with browser_click / browser_type itself, so
 * every action still goes through the tools, the approvals and the computer's own refusals. No new way to act.
 *
 * Only where a text state exists. A desktop or a VNC console is pixels: there is nothing to number, and Laya does not
 * read images — those stay computer_look's (a vision reader). A page's elements can be hundreds, and a choice's
 * options share one small token budget (~190 tokens on Laya's English checkpoint), so they are answered as a
 * tournament: groups of GROUP in one forward pass, then the groups' winners in a second.
 */
const one = () => require('./index');

const GROUP = 10;
const LABEL = 48;

/** browser_snapshot's text → { title, url, elements: [{ref, kind, label, href}], text }. */
function parse(snapshot) {
  const s = String(snapshot || '');
  const title = (s.match(/^title: (.*)$/m) || [])[1] || '';
  const url = (s.match(/^url: (.*)$/m) || [])[1] || '';
  const elements = [];
  for (const m of s.matchAll(/^\[(\d+)\] (\S+) "(.*?)"(?: -> (\S+))?$/gm)) elements.push({ ref: Number(m[1]), kind: m[2], label: m[3], href: m[4] || '' });
  const at = s.indexOf('--- text ---');
  return { title, url, elements, text: at >= 0 ? s.slice(at + 12).trim() : '' };
}

/** How an element is shown as an option: its kind and words, short (the options share the head's budget). */
function describe(e) {
  const kind = e.kind.replace(/^input:(text|search|email|url|tel|number)$/, 'field').replace(/^textarea.*/, 'field')
    .replace(/^a(\[link\])?$/, 'link').replace(/\[button\]$/, ' button').replace(/^button:\w+$/, 'button');
  const words = (e.label || (e.href ? e.href.replace(/^https?:\/\/[^/]+/, '') : '') || '(no label)').slice(0, LABEL);
  return `${kind} "${words}"`;
}

const howFor = kind => (/^(input|textarea|select)/.test(kind) && !/:(checkbox|radio|submit|button)$/.test(kind) ? 'type' : 'click');

/**
 * The state Laya reads: the goal in the person's words and the page's title — not the page's text, which on a panel
 * page buried the goal (measured: 4 of 33 right with 600 characters of it, see the write-up).
 */
const stateOf = (goal, page) => `I want to ${String(goal).replace(/[.\s]+$/, '').slice(0, 300)}. I am on the page "${String(page.title || page.url).slice(0, 120)}".`;

const groupQ = (id, els) => ({ id, type: 'choice', instructions: 'Which control should I use?',
  options: Object.fromEntries(els.map(e => [`e${e.ref}`, describe(e)])) });

/**
 * The proposal: { choices: [{ref, kind, label, p, how}], confidence, sure, by, rounds, ms, page }, or
 * throws (the caller says the model could not answer).
 */
async function propose({ goal, snapshot, person = null, top = 3 }) {
  const page = parse(snapshot);
  if (!page.elements.length) return { choices: [], confidence: 0, sure: false, by: 'nothing to number on this page', rounds: 0, page };
  const state = stateOf(goal, page);
  const byRef = new Map(page.elements.map(e => [`e${e.ref}`, e]));
  let pool = page.elements, rounds = 0, ms = 0, by = '';
  while (pool.length > GROUP) {   // a round: each group of GROUP answered in one forward pass, its best two go on
    const groups = [];
    for (let i = 0; i < pool.length; i += GROUP) groups.push(pool.slice(i, i + GROUP));
    const r = await one().decide({ state, questions: groups.map((g, i) => groupQ(`g${i}`, g)), person, timeoutMs: 15000 });
    rounds++; ms += r.ms; by = `${r.provider} (${r.model})`;
    pool = groups.flatMap((g, i) => one().ranked(r.answers[`g${i}`]).slice(0, g.length > 2 ? 2 : 1).map(([k]) => byRef.get(k)).filter(Boolean));
  }
  const r = await one().decide({ state, questions: [groupQ('element', pool)], person, timeoutMs: 15000 });
  rounds++; ms += r.ms; by = `${r.provider} (${r.model})`;
  const el = r.answers.element;
  const choices = one().ranked(el).slice(0, top).map(([k, p]) => { const e = byRef.get(k); return { ref: e.ref, kind: e.kind, label: e.label, p, how: howFor(e.kind) }; });
  return { choices, confidence: el.confidence, sure: one().sure(el), by: `${by}, ${rounds} round${rounds === 1 ? '' : 's'}, ${ms} ms`, rounds, ms, page };
}

/** The proposal in words for the agent: a guess with its probabilities, never an instruction. */
function say(goal, p) {
  if (!p.choices.length) return `Nothing on this page is numbered (${p.by}) — computer_next reads browser_snapshot's elements; for a canvas, a desktop or a remote screen use computer_look.`;
  const pct = x => `${Math.round(x * 100)}%`;
  const lines = p.choices.map((c, i) => `${i + 1}. [${c.ref}] ${c.kind} "${c.label}" — ${pct(c.p)} → ${c.how === 'type' ? 'browser_type' : 'browser_click'}`);
  return [`The System 1 model's guess for "${String(goal).slice(0, 120)}" on ${p.page.title || p.page.url} (${p.by}):`, ...lines,
    p.sure ? `Confidence ${p.confidence.toFixed(2)} — at or above the owner's threshold.`
      : `Confidence ${p.confidence.toFixed(2)} — under the owner's threshold (systemOne.threshold): treat it as a weak hint and choose from the snapshot yourself.`,
    'It only proposes: check it against the snapshot, then act with the computer\'s own tools.'].join('\n');
}

/** computer_next: the turn's own computer only, read through its own browser_snapshot. */
async function next({ computer, goal }, ctx = {}) {
  if (!one().on()) return 'Error: the System 1 model is an experiment that is off (Settings → Developer).';
  if (!String(goal || '').trim()) return 'Error: say the goal, e.g. "open Settings" or "add a provider".';
  const whose = require('../computers/whose');
  const mine = whose.ofConversation(ctx.sessionId);
  if (!mine.includes(String(computer || '')))
    return `Error: computer ${computer} is not one this conversation works in (${mine.length ? `yours: ${mine.join(', ')}` : 'it has none'}).`;
  whose.check(ctx.user, computer);
  const snapshot = await require('../mcp/tools').call(`mcp__computer-${computer}__browser_snapshot`, {});
  if (/^Error:/.test(snapshot)) return snapshot;
  try { return say(goal, await propose({ goal, snapshot, person: ctx.user })); }
  catch (e) { return `Error: the System 1 model did not answer (${e.message}) — choose from browser_snapshot yourself.`; }
}

module.exports = { parse, describe, howFor, stateOf, propose, say, next, GROUP };
