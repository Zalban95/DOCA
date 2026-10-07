'use strict';

/**
 * Asked instead of refused, at a person's own budget (CONSTITUTION S12; TODO P1.6). A budget a person set for
 * themselves is theirs to step over: when it is reached as their own turn starts, they are asked once — "Your budget of
 * X is reached — go over it for this turn?" — on the panel's question card and, for a turn a device started, on that
 * device (reach.ask), first answer wins. Yes is this turn only, recorded in the audit log; the budget stays as it is.
 *
 * Only for:
 *   - their own budget: one an admin or a team leader set, or their level's, still refuses — whoever set it raises it;
 *     and when another budget is reached too, that one refuses without asking (spending.beforeTurn overOwn);
 *   - their own turn: a person on it, not work done on their behalf (a mission, a work chat, a schedule, a recipe, the
 *     panel's own wake-ups — those have nobody watching, and refuse as before); a host writing in someone else's
 *     conversation spends that person's budget, which is not theirs to step over.
 * The question is approval.js's card (forced: allowed once or denied, never "always") and reach.js's prompt: no new
 * machinery, and the person who may answer it is the person whose turn it is, or a host (approval-answer.js).
 */
const UNWATCHED = new Set(['agent', 'schedule', 'recipe']);

/** Whose turn this is, for asking: the person, or null when this turn has nobody to ask (it then refuses as before). */
function askable({ client, profile, sessionId }) {
  const person = client?.user;
  if (!person?.id || person.onBehalf || UNWATCHED.has(client.kind)) return null;
  if (require('../harness/turn/prompt').isMissionProfile(profile)) return null;
  const s = require('../harness/memory').getSession(sessionId);
  if (s?.kind === 'specialist') return null;
  // The budget counted is the conversation's person's (budgets.personFor): only theirs is theirs to step over.
  let owner = null;
  try { owner = require('../harness/session-access').ownerOf(sessionId); } catch { /* no such conversation yet */ }
  return !owner || owner === person.id ? person : null;
}

/** Put the question and wait: 'once' (go over), 'deny', 'timeout' or 'cancelled'. */
async function ask(e, { client, sessionId, signal, say = () => {} }) {
  const approval = require('../harness/approval');
  const person = client.user;
  const req = { tool: 'going over your budget', keys: null, forced: true, budget: true, personId: person.id,
    summary: `Your budget of ${e.over.what} is reached (${e.over.spent}). Go over it for this turn only? Your budget stays as it is; `
      + 'you can raise it in Settings → Spending.' };
  const { id, answer } = approval.ask(req, { sessionId, signal });
  say({ type: 'approval', state: 'asked', id, ...req });
  // A turn a device started is asked there too: often the only place its person is looking.
  const deviceId = client.id && client.kind !== 'dashboard' ? client.id : null;
  if (deviceId) {
    const ctrl = new AbortController();
    signal?.addEventListener?.('abort', () => ctrl.abort(), { once: true });
    answer.then(() => ctrl.abort());
    require('../harness/reach').ask({ to: [deviceId], question: 'Go over your budget for this turn?', note: req.summary,
      choices: [{ id: 'approve', label: 'Yes, this turn' }, { id: 'deny', label: 'No' }], timeoutSec: 240, signal: ctrl.signal })
      .then(r => {
        if (r?.status !== 'answered') return;
        try { require('../harness/approval-answer').answerAs({ id, decision: r.choiceId === 'approve' ? 'once' : 'deny', person }); } catch { /* answered at the panel */ }
      })
      .catch(() => { /* no such device, or it takes no prompts: the panel still has it */ });
  }
  const decision = await answer;
  say({ type: 'approval', state: 'answered', id, decision, tool: req.tool });
  return decision;
}

/** A yes, recorded: who, which budget, which conversation — never what was said. */
function record(e, person, sessionId) {
  try {
    require('../auth/store').audit({ actorId: person.id, action: 'spending.over',
      detail: `own budget ${e.over.field} ${e.over.limit} reached (${e.over.spent}); went over it for one turn in ${sessionId}` });
  } catch { /* accounting must not stop the turn */ }
}

/** The sentence a turn ends with when the answer was not yes. */
function declined(e, decision) {
  const why = decision === 'timeout' ? 'Nobody answered the question about going over it within five minutes.'
    : decision === 'cancelled' ? 'The turn was stopped while it waited for an answer.' : 'You chose not to go over it.';
  return Object.assign(new Error(`${e.message} ${why}`), { status: 429, code: 'budget_reached', over: e.over });
}

module.exports = { askable, ask, record, declined };
