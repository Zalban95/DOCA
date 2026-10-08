'use strict';

/**
 * A System 1 decision model (experiment `systemOne`, docs/experiments/system-one.md; asked 2026-10-08): a state and
 * typed questions in, calibrated probabilities out, in one forward pass and with no text generated. Two providers
 * speak the same wire — TypeSafe's `POST /v1/systemone` — so either serves the same `decide()`:
 *   - laya: the open Laya model (ConvAI Innovations, Apache 2.0), run by this hub through `laya-serve` on 127.0.0.1
 *     (service.js), with a bearer secret made at each start so another account on the machine cannot use it;
 *   - jev: TypeSafe's closed API, with a key for services (Field → Connectors) named by `systemOne.jevKey`, sent only to
 *     that key's own origin (service-keys.apply), never into a computer.
 *
 * DOCA's question shape is a list — [{id, type: choice|score|noul, instructions, options}] — turned into the wire's map.
 * An answer is used only when its `confidence` — the probability of its top choice, Laya's `answer_confidence`, which is
 * what its temperature scaling calibrates (its own normalised-entropy `confidence` is not) — reaches `systemOne.threshold`; below it, and on any failure, the caller does what it did before. Off — the flag or
 * developer mode — `decide()` is never reached: each caller asks `on()` first.
 */
const JEV = 'https://api.typesafe.ai/v1/systemone';

const schema = () => require('../settings-schema');
const on = () => require('../experiments').on('systemOne');

function settings() {
  const v = k => schema().value(`systemOne.${k}`);
  return { provider: v('provider') === 'jev' ? 'jev' : 'laya', threshold: Number(v('threshold')), port: Number(v('port')),
    checkpoint: v('checkpoint') || 'english', jevKey: v('jevKey') || 'typesafe', jevVersion: v('jevVersion') || 'jev-latest' };
}

/** DOCA's list of questions as the wire's map: options as {key: description} or a list of labels. */
function wireQuestions(questions) {
  const out = {};
  for (const q of questions || []) {
    if (!q?.id || !['choice', 'score', 'noul'].includes(q.type)) throw new Error(`question ${q?.id || '?'}: type is choice, score or noul`);
    out[q.id] = { type: q.type, instructions: String(q.instructions || ''), ...(q.type === 'noul' ? {} : { criteria: q.options }) };
  }
  return out;
}

/** The probability of the top choice: Laya's `answer_confidence` when it sends one, else read off the probabilities. */
const topProbability = (a, probs) => (Number.isFinite(a.answer_confidence) ? a.answer_confidence : Math.max(0, ...Object.values(probs || {}).map(Number).filter(Number.isFinite)));

/** One answer in DOCA's shape: { type, choice | score | yes, probabilities, confidence }. */
function normalise(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.type === 'noul') {
    const yes = Number(a.noul);
    const probabilities = { no: +(1 - yes).toFixed(4), yes: +yes.toFixed(4) };
    return { type: 'noul', yes, probabilities, confidence: Math.max(yes, 1 - yes) };
  }
  const probabilities = a.probabilities || {};
  const base = { type: a.type, probabilities, confidence: topProbability(a, probabilities) };
  return a.type === 'score' ? { ...base, score: Number(a.score) } : { ...base, choice: a.choice };
}

/** Where to send, and with what, for the provider in use — or an Error saying what is missing. */
function target(s, person) {
  if (s.provider === 'laya') {
    // A Laya server someone else runs (and the tests' stub): its address, and its bearer secret if it has one.
    if (process.env.DOCA_SYSTEM_ONE_URL) return { url: process.env.DOCA_SYSTEM_ONE_URL, model: s.checkpoint,
      headers: process.env.DOCA_SYSTEM_ONE_KEY ? { Authorization: `Bearer ${process.env.DOCA_SYSTEM_ONE_KEY}` } : {} };
    const svc = require('./service');
    if (!svc.running()) return new Error('Laya\'s service is not running (Field → Models → Decision models).');
    return { url: `http://127.0.0.1:${svc.port()}/v1/systemone`, headers: { Authorization: `Bearer ${svc.secret()}` }, model: s.checkpoint };
  }
  const host = !person?.id || require('../auth/rights').can(person.role, 'host');
  try {
    const r = require('../service-keys').apply(s.jevKey, JEV, {}, { host });
    return { url: r.url, headers: r.headers, model: s.jevVersion, key: r.key };
  } catch (e) { return e; }
}

/**
 * Ask the model. @returns {Promise<{provider, model, ms, answers: {[id]: answer}}>} — throws when it cannot answer,
 * so a caller's catch is its fallback. `extra` carries the wire's own knobs (max_len, head_max_len) for Laya.
 */
async function decide({ state, questions, person = null, timeoutMs = 5000, extra = {} } = {}) {
  const s = settings();
  const t = target(s, person);
  if (t instanceof Error) throw t;
  const started = Date.now();
  const r = await fetch(t.url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', ...t.headers },
    body: JSON.stringify({ model: t.model, state, questions: wireQuestions(questions), ...(s.provider === 'laya' ? extra : {}) }) });
  const text = await r.text();
  const said = t.key ? require('../service-keys').scrub(text, t.key) : text;
  if (!r.ok) throw new Error(`${s.provider} answered HTTP ${r.status}: ${said.slice(0, 200)}`);
  let j;
  try { j = JSON.parse(said); } catch { throw new Error(`${s.provider} did not answer in JSON`); }
  const answers = {};
  for (const [id, a] of Object.entries(j.answers || {})) answers[id] = normalise(a);
  return { provider: s.provider, model: j.model || t.model, ms: Date.now() - started, answers };
}

/** Whether an answer is sure enough to be used. */
const sure = (answer, threshold = settings().threshold) => !!answer && Number(answer.confidence) >= threshold;

/** The choices of an answer, most likely first: [[key, p], …]. */
const ranked = answer => Object.entries(answer?.probabilities || {}).sort((a, b) => b[1] - a[1]);

module.exports = { on, settings, decide, sure, ranked, wireQuestions, normalise, JEV };
