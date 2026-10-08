'use strict';

/**
 * A mission's use of a machine, asked of its person (the owner's rule, 2026-10-08: "If the agents need a machine to
 * test something, they might ask for confirmation"). A mission runs unwatched, so approval.gate's questions are refused
 * in it (approval.missionRefusal) — except these two, which are asked of the person the mission works for:
 *
 *   - `vnc_input` on the VNC screen lent to it (agent_dispatch vnc:);
 *   - on the computer lent to it, when that is not a test computer, a browser click or type with confirm: true on a
 *     control the computer calls a sign-in — a sign-in or log-in, or the submit of a form holding a password
 *     (clients/computer/tools.js signInOnly(), asked through its hidden browser_classify). What pays, buys, confirms or
 *     deletes, a card field, and every other forced ask stay refused in a mission.
 *
 * Whose: the person who owns the mission's conversation up the chain (session-access.ownerOf) — on their own devices
 * that take questions (one reach.ask to all of them) and, through the live feed's `ask` topic, in the approval popup of
 * any page of theirs that is open; never another person's. First answer wins, allowed once or denied — no "always", and
 * not "approve all": a machine is asked each time it is used. Nobody answering within `harness.approval.missionAskSec`
 * is what `harness.approval.missionAskTimeout` says (asked 2026-10-08: "the timeout counts as hold instead of no, or
 * even better a setting"): **hold** (the default) — the question stays open in Harness → Approvals and the popup, the
 * copy on the person's devices is withdrawn to keep a wrist clean, and the mission waits, paused inside its step (no
 * model request, no tokens), until someone answers or a person stops it; a restart keeps it as a note the resumed
 * mission reads (mission-asks-held.js) — or **deny**, with a sentence the mission reports to its leader. The
 * specialist's other limits (registry.NEVER) are untouched, and a person driving the machine still makes the call wait
 * (toolbox/vnc.js, computers/takeover.js).
 */
const DEFAULT_SEC = 300;
const COMPUTER_TOOL = /^mcp__computer-([a-f0-9]+)__browser_(click|type)$/;

/** How long a mission's machine question waits for its person, in seconds (a declared setting, never proposable). */
function waitSec() {
  try { return require('../settings-schema').value('harness.approval.missionAskSec'); } catch { return DEFAULT_SEC; }
}

/** What an unanswered machine question becomes: 'hold' (it stays open, the mission waits) or 'deny'. Never proposable. */
function onTimeout() {
  try { return require('../settings-schema').value('harness.approval.missionAskTimeout') === 'deny' ? 'deny' : 'hold'; } catch { return 'hold'; }
}

/**
 * Whether this forced ask is machine use its person may answer: `{ kind, machine, what }` — the machine's name and what
 * the call would do there, never text it would type — or null (the call is refused as before).
 */
async function machineUse(name, args, { profile } = {}) {
  if (name === 'vnc_input') {
    const t = profile?.vnc ? require('../vnc-targets/store').find(String(args?.target || '')) : null;
    if (!t || t.id !== profile.vnc) return null;   // only the screen lent to this mission
    const at = args?.action === 'type' ? ` (${String(args?.text || '').length} characters)` : args?.keys ? ` (${args.keys})`
      : args?.x != null ? ` at ${args.x},${args.y}` : '';
    return { kind: 'vnc', machine: `the VNC screen ${t.name}`, what: `${args?.action || 'act'}${at}` };
  }
  const m = COMPUTER_TOOL.exec(name);
  if (!m || args?.confirm !== true || !profile?.computer || profile.computer !== m[1]) return null;
  const computers = require('../computers');
  const c = computers.get(m[1]);
  if (!c || c.test) return null;   // a test computer's sign-ins need no confirm; what it is asked about pays or deletes
  const s = await classify(c, args.ref);
  if (!s || !s.signIn || (m[2] === 'type' && s.kind === 'secret')) return null;   // pays, buys, a card — or a password the agent may not type there
  const what = m[2] === 'click' ? `click [${args.ref}]${s.label ? ` "${s.label}"` : ''}`
    : `type ${String(args?.text || '').length} characters into [${args.ref}]${args?.submit ? ' and submit the form' : ''}`;
  return { kind: 'computer', machine: `the computer ${c.name}`, what: `${what} — a sign-in` };
}

/** What the computer says [ref] is: { kind, label, signIn }, or null when it cannot say (an older image: refused). */
async function classify(c, ref) {
  try { return JSON.parse(await module.exports.computerCall(c, 'browser_classify', { ref: Number(ref) })); } catch { return null; }
}

/** The person's own devices that take a question: never another person's, never a paired agent or a browser. */
function devicesOf(personId) {
  if (!personId) return [];
  const { hasScope } = require('../api-v1/scopes');
  return require('../api-v1/devices').list().filter(d => d.userId === personId && !d.revokedAt
    && !['agent', 'browser'].includes(d.kind) && hasScope(d.scopes, 'interact'));
}

/**
 * Ask the mission's person and wait: 'once', 'deny', 'timeout' or 'cancelled'. `gate` is approval.gate's request;
 * `say` writes the question and its answer into the mission's transcript.
 */
async function ask(gate, use, { sessionId, missionId, profile, signal, say = () => {}, step } = {}) {
  const approval = require('./approval');
  const live = require('../live');
  let personId = null;
  try { personId = require('./session-access').ownerOf(sessionId); } catch { /* no such conversation: hosts answer */ }
  const who = profile?.label || profile?.id || 'a specialist';
  const req = { tool: gate.tool, keys: null, forced: true, machine: true, personId, mission: { id: missionId, agent: who },
    summary: `The mission ${missionId || ''} (${who}) asks to ${use.what} on ${use.machine}. Allow it this once? A machine is asked each time it is used.` };
  const sec = module.exports.waitSec(), hold = module.exports.onTimeout() === 'hold';
  if (hold) Object.assign(req, { held: true, summary: `${req.summary} The mission waits, paused, until you answer.` });   // nobody answering is not a no
  const { id, answer } = approval.ask(req, { sessionId, signal, timeoutMs: hold ? null : sec * 1000 });
  say({ type: 'approval', step, state: 'asked', id, ...req });
  live.changed('ask', id, 'asked', { personId, req: { id, ...req } });   // the popup on the person's open pages
  const held = require('./mission-asks-held');
  held.asking(missionId, { id, sessionId, tool: gate.tool, what: use.what, machine: use.machine });   // the bar says it waits; a restart keeps it

  const ctrl = new AbortController();
  const mine = devicesOf(personId);
  if (mine.length) require('./reach').ask({ to: mine.map(d => d.id), question: `Allow ${who} to use ${use.machine}?`, note: req.summary,
    choices: [{ id: 'approve', label: 'Allow once' }, { id: 'deny', label: 'Deny' }], timeoutSec: sec, signal: ctrl.signal })
    .then(r => {
      const d = r?.status === 'answered' && mine.find(x => x.id === r.device?.id);   // one of theirs answered (not a card at a panel)
      if (!d) return;
      try { require('./approval-answer').answerAs({ id, decision: r.choiceId === 'approve' ? 'once' : 'deny', person: require('./turn/client').deviceOwner(d) }); }
      catch { /* answered elsewhere */ }
    })
    .catch(() => { /* none takes questions now: the panel still has it */ });
  const decision = await answer;
  held.answered(missionId);
  ctrl.abort();   // first answer wins: the other copies are withdrawn
  live.changed('ask', id, 'answered', { personId, decision });
  say({ type: 'approval', step, state: 'answered', id, decision, tool: gate.tool });
  return decision;
}

/** The sentence the mission reads when the answer was not yes — what it reports to its leader. */
function refusal(decision, use) {
  const why = decision === 'timeout' ? `nobody answered within ${module.exports.waitSec()} seconds, so it was denied`
    : decision === 'cancelled' ? 'the mission was stopped while it waited' : 'your person denied it';
  return `Not run: asked to ${use.what} on ${use.machine}, and ${why}. Report this to your leader as the reason this `
    + 'step was not done — what you meant to do there and why; do not reach the same end another way.';
}

module.exports = { machineUse, ask, refusal, waitSec, onTimeout, devicesOf, computerCall: (...a) => require('../logins').computerCall(...a) };
