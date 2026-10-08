'use strict';

/**
 * The bounded decisions DOCA makes before a turn, asked of the System 1 model (experiment `systemOne`): each is a typed
 * question about the request, and each answer is used only when the model is sure enough (`systemOne.threshold`).
 * Otherwise — unsure, off, not running, slow — the caller's own way decides, exactly as without the experiment:
 *   - size: the triage's small / medium / large and quick / normal (turn/triage.js), asked where today the rules are
 *     unsure and the quick model would be;
 *   - route: a call's answer-now or hand-to-a-work-chat (turn/front.js).
 * Options carry neutral keys and a description each: Laya's card warns that a yes/no (`noul`) question can follow its
 * own labels instead of the text, and says to ask a two-option choice instead.
 */
const one = () => require('./index');

// The wording is the measured one (docs/experiments/system-one.md): the request quoted as said, a plain question.
const SIZE = {
  id: 'size', type: 'choice', instructions: 'How big a job is this?',
  options: { small: 'tiny: a direct answer or one quick action', medium: 'a few steps',
    large: 'a big job over many steps: building, setting up, fixing or researching' },
};
const PACE = {
  id: 'pace', type: 'choice', instructions: 'How does the person want it?',
  options: { A: 'quickly: a short answer right away', B: 'at a normal pace: as thorough as the job needs' },
};
const ROUTE = {
  id: 'route', type: 'choice', instructions: 'Is this a quick request or a big job?',
  options: { now: 'a quick request: a question, a fact, or one simple action', later: 'a big job: many steps, research, building, fixing or organising things' },
};

const asked = (message, voice) => `Someone ${voice ? 'says to their voice assistant' : 'asks their AI assistant'}: "${String(message || '').slice(0, 1500)}"`;

const TIMEOUT_MS = 3000;   // a decision before a turn: past this, today's way decides

/** One question about the request; null unless on, answered and sure. */
async function askOne(question, message, person) {
  if (!one().on()) return null;
  try {
    const r = await one().decide({ state: asked(message, question.id === 'route'), questions: [question], person, timeoutMs: TIMEOUT_MS });
    const a = r.answers[question.id];
    return { answer: a, sure: one().sure(a), by: `${r.provider} (${r.model}, ${r.ms} ms)`, all: r };
  } catch { return null; }
}

/**
 * The triage's verdict from the model — { difficulty, urgency, by, confidence } — or null to leave it to the quick
 * model and the rules. The pace is asked in the same forward pass; it is used only when it too is sure.
 */
async function size(message, person) {
  if (!one().on()) return null;
  let r;
  try { r = await one().decide({ state: asked(message, false), questions: [SIZE, PACE], person, timeoutMs: TIMEOUT_MS }); } catch { return null; }
  const s = r.answers.size, p = r.answers.pace;
  if (!one().sure(s) || !['small', 'medium', 'large'].includes(s.choice)) return null;
  return { difficulty: s.choice, urgency: one().sure(p) && p.choice === 'A' ? 'quick' : 'normal', confidence: s.confidence,
    by: `${r.provider} (${r.model}, ${r.ms} ms, confidence ${s.confidence.toFixed(2)})` };
}

/** A call's route from the model — { delegate, why } — or null to leave it to the rules. */
async function route(message, person) {
  const r = await askOne(ROUTE, message, person);
  if (!r?.sure || !['now', 'later'].includes(r.answer.choice)) return null;
  return { delegate: r.answer.choice === 'later', why: `the System 1 model: ${r.answer.choice === 'later' ? 'a longer piece of work' : 'right away'} (${r.by}, confidence ${r.answer.confidence.toFixed(2)})` };
}

module.exports = { size, route, asked, SIZE, PACE, ROUTE, TIMEOUT_MS };
