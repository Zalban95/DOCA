'use strict';

/**
 * Where a request to the main chat goes, decided before any model is asked (experiment alwaysFree,
 * docs/experiments/always-free.md; the design "Always free", phase 1). Without the flag this is front.planned, as
 * before (CONSTITUTION W14: today's path stays the alternative).
 *
 * With it, on every turn of the Orchestrator's conversation — typed or spoken — and on every call, whatever
 * `assistant.calls` says:
 *
 *   - a clear job goes to a work chat at once (fork.js), with a fixed line naming it: the person asked to think
 *     harder / take their time with a request beside it (front.DEEP), the triage's rules call it large (a build verb
 *     on a whole thing, a list of steps, a long message), or the System 1 model is sure it is "later";
 *   - a call that is not a job is a front turn: the short kit (front.FRONT), and no work of its own beyond one quick
 *     visible action (turn/handoff.js QUICK);
 *   - a typed turn that is not a clear job runs as ever, with the same safety net: its first call that is real work
 *     hands the job on (handoff.step), carrying what it had read.
 *
 * Rules first (≈0 ms), then System 1 where it is on (≈12–100 ms). No quick model is asked here: on a local model that
 * would cost seconds before the first word, which is what this experiment removes.
 */
const on = () => require('../../experiments').on('alwaysFree');
const spoken = client => client?.mode === 'assistant' || client?.mode === 'call';

/** The rules' verdict: { delegate, deep, why } for a clear job, else null. Pure: what the person wrote, and the session. */
function job({ message, session }) {
  const front = require('./front');
  const text = String(message || '');
  const deep = front.DEEP.test(text);
  const rest = text.replace(front.DEEP, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  if (deep && rest.length >= 3) return { delegate: true, deep: true, why: `asked to "${text.match(front.DEEP)[0].toLowerCase()}"` };
  const rated = require('./triage').rate({ message: text, session });   // its size; a call's lean is towards quick, not small
  if (rated.difficulty === 'large') return { delegate: true, deep: false, why: `a large request (${rated.reasons.join(', ')})` };
  return null;
}

/**
 * For agent.js: this turn's shape — { delegate, deep, why } (hand on now), a front turn's { steps, workSteps, off }, or
 * null for an ordinary turn.
 */
async function decide(args) {
  const front = require('./front');
  if (!on()) return front.planned(args);
  const { client, profile, session } = args;
  if (profile && profile.level !== 'orchestrator') return null;   // a specialist is never the front
  const main = profile?.level === 'orchestrator' || session?.kind === 'orchestrator';
  const voice = spoken(client);
  if (!main && !voice) return null;
  if (args.message && require('../slash').parse(args.message)) return null;   // a command is answered where it is
  const rules = job(args);
  if (rules) return rules;
  const s1 = await require('../../system-one/decisions').route(args.message, client?.user);
  if (s1?.delegate) return { delegate: true, deep: false, why: s1.why };
  if (!voice || require('../../settings-schema').value('assistant.front') === false) return null;
  return { delegate: false, steps: front.STEPS, workSteps: 0, off: disabled => front.offOutside(disabled) };
}

module.exports = { decide, job, on };
