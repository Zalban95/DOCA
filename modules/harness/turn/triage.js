'use strict';

/**
 * Limits that follow the work (experiment `adaptiveLimits`, docs/experiments/adaptive-limits.md; TODO H10.6,
 * CONSTITUTION P20): before a turn, a cheap look at the request rates its difficulty (small, medium, large) and its
 * urgency (quick or normal), and sets that turn's thinking effort and step budget.
 *
 * Rules first, deterministic and free: what the message looks like, the words in it, who asked (a call or a watch wants
 * quick), and whether the conversation has a plan with open steps. Only when the rules are unsure is a model asked:
 * the System 1 decision model when experiment systemOne is on and it is sure (system-one/decisions.js), else — as
 * before — assistant mode's quick model, once, when the owner has set one. The budget is never below today's `maxSteps` — the
 * owner asked for limits that follow the work, not limits lowered to save tokens — and never above the ceiling
 * `limits.maxStepsCeiling`, which is his and not proposable.
 */
const schema = () => require('../../settings-schema');
const on = () => require('../../experiments').on('adaptiveLimits');

const QUICK = /\b(quick(ly)?|just|briefly|brief|in a word|in one word|tl;?dr|asap|short answer)\b/i;
const QUESTION = /^\s*(what|who|whom|whose|when|where|which|why|how (much|many|old|long|far)|is|are|was|were|do|does|did|can|could|should|would|will)\b/i;
const BUILD = /\b(build|implement|create|develop|refactor|migrate|port|set ?up|install and|configure|debug|fix|deploy|write (a|an|the) (script|program|test|app|tool|module|function|service)|design|automate|integrate|research)\b/i;
const WHOLE = /\b(app|application|project|website|site|pipeline|from scratch|end to end|end-to-end|every|all the|whole|entire|full)\b/i;
const STEPS = /^\s*(\d+[.)]|[-*•])\s+\S/gm;

const LEVELS = ['small', 'medium', 'large'];

/** Open steps in the conversation's plan (a work chat's job), or 0. */
function openPlanSteps(session) {
  const plan = session?.job?.plan;
  if (!plan?.steps?.length) return 0;
  return plan.steps.filter((_, i) => plan.progress?.[i + 1] !== 'done').length;
}

/**
 * The rules' verdict: { difficulty, urgency, sure, reasons }. Pure: the message, the client, the session — nothing read
 * from settings, so the tests can hold every rule.
 */
function rate({ message = '', client = null, session = null } = {}) {
  const text = String(message || '').trim();
  const reasons = [];
  let small = 0, large = 0, quick = false;
  const lean = (side, n, why) => { if (side === 'small') small += n; else large += n; reasons.push(why); };

  if (text.length < 60) lean('small', 1, 'a short message');
  const question = /\?\s*$/.test(text) || QUESTION.test(text);
  if (question && text.length < 160) lean('small', 1, 'a short question');
  if (QUICK.test(text)) { quick = true; lean('small', 1, `"${text.match(QUICK)[0].toLowerCase()}"`); }
  const spoken = client?.mode === 'assistant' || client?.mode === 'call';
  const wrist = (client?.formFactor || client?.kind) === 'watch';
  if (spoken || wrist) { quick = true; lean('small', 1, spoken ? 'a call' : 'a watch'); }
  if (BUILD.test(text)) lean('large', 1, `a build request ("${text.match(BUILD)[0].toLowerCase()}")`);
  if (WHOLE.test(text) && BUILD.test(text)) lean('large', 1, `a whole thing ("${text.match(WHOLE)[0].toLowerCase()}")`);
  if (text.length > 1000) lean('large', 2, 'a very long message');
  else if (text.length > 400) lean('large', 1, 'a long message');
  if ((text.match(STEPS) || []).length >= 3) lean('large', 2, 'a list of steps');
  const open = openPlanSteps(session);
  if (open) lean('large', 1, `a plan with ${open} open step${open === 1 ? '' : 's'}`);

  const score = large - small;
  const difficulty = score >= 2 ? 'large' : score <= -1 ? 'small' : 'medium';
  // Medium is where the rules disagree or say nothing: the one place a model is worth asking.
  return { difficulty, urgency: quick ? 'quick' : 'normal', sure: difficulty !== 'medium', reasons: reasons.length ? reasons : ['nothing stood out'] };
}

/** "large normal" → { difficulty, urgency }, or null when the answer is not that. */
function parseModel(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
  const difficulty = words.find(w => LEVELS.includes(w));
  if (!difficulty) return null;
  return { difficulty, urgency: words.includes('quick') ? 'quick' : 'normal' };
}

const MODEL_PROMPT = 'You sort requests to an AI agent that can use tools. Reply with two words and nothing else: '
  + 'how much work it is — small (an answer or one quick action), medium (a few steps), large (a build, a fix across '
  + 'files, research, many steps) — and whether the person wants it quick or normal. Example: "medium normal".';

/** The assistant's quick model, asked once; null when none is set or it does not answer in time. */
async function askModel(message, person) {
  const model = schema().value('assistant.model');
  if (!model) return null;
  const provider = schema().value('assistant.provider') || require('./params').params().provider;
  try {
    // For a person, only if the quick model is allotted to them (ask refuses otherwise): the rules decide instead.
    const reply = await require('./transport').ask({ system: MODEL_PROMPT, user: String(message).slice(0, 2000), provider, model, person,
      temperature: 0, signal: AbortSignal.timeout(20e3) });
    const v = parseModel(reply);
    return v && { ...v, model: `${provider} / ${model}` };
  } catch { return null; }
}

/** The ceiling: the owner's, never below the base (a ceiling under today's maxSteps would lower it). */
const ceilingFor = base => Math.max(base, Math.floor(Number(schema().value('limits.maxStepsCeiling')) || base));

/** Steps for a difficulty: the base, twice it or four times it, within [base, ceiling]. */
function stepsFor(difficulty, base, ceiling) {
  const factor = { small: 1, medium: 2, large: 4 }[difficulty] || 1;
  return Math.min(Math.max(base, ceiling), Math.max(base, base * factor));
}

/** Thinking effort for a verdict (turn/effort.js levels). */
const effortFor = v => (v.urgency === 'quick' || v.difficulty === 'small' ? 'low' : v.difficulty === 'large' ? 'high' : 'medium');

/**
 * For agent.js: the turn's verdict — { difficulty, urgency, by, reasons, effort, steps, base, ceiling } — or null when
 * the experiment is off (and then nothing about the turn changes).
 */
async function verdict({ message, client, session, p }) {
  if (!on()) return null;
  const base = Math.max(1, Number(p?.maxSteps) || 1);
  const rules = rate({ message, client, session });
  let v = { ...rules, by: 'rules' };
  if (!rules.sure) {
    // The System 1 model first (experiment systemOne): sure, it decides; unsure or off, the quick model as before.
    const s1 = await require('../../system-one/decisions').size(message, client?.user);
    const m = s1 || await askModel(message, client?.user);
    if (m) v = { ...rules, difficulty: m.difficulty, urgency: rules.urgency === 'quick' ? 'quick' : m.urgency, by: s1 ? `System 1: ${s1.by}` : `model (${m.model})` };
  }
  const ceiling = ceilingFor(base);
  return { difficulty: v.difficulty, urgency: v.urgency, by: v.by, reasons: v.reasons, effort: effortFor(v), steps: stepsFor(v.difficulty, base, ceiling), base, ceiling };
}

/** The turn's effort with the verdict applied: a level the person set for this conversation still wins. */
function effort(levelFor, v) {
  if (!v || levelFor.from === 'this conversation') return levelFor;
  return { level: v.effort, from: `the triage: ${v.difficulty}${v.urgency === 'quick' ? ', quick' : ''} (experiment adaptiveLimits)` };
}

/** The `# Your limits` line for the steps, when a verdict set them. */
const limitsLine = v => `tool steps: ${v.steps} this turn — the triage rated it ${v.difficulty}${v.urgency === 'quick' ? ' and quick' : ''} `
  + `(${v.reasons.join(', ')}; experiment adaptiveLimits); harness.config.doca.maxSteps (${v.base}) is the least it gives. `
  + `While your steps keep succeeding it is extended, up to limits.maxStepsCeiling (${v.ceiling}), the owner's`;

module.exports = { rate, parseModel, stepsFor, effortFor, ceilingFor, verdict, effort, limitsLine, openPlanSteps, MODEL_PROMPT };
