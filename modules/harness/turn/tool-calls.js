'use strict';

/**
 * One step's tool calls: parse, gate, run, record. Moved out of `runTurn`
 * unchanged — the turn decides *whether* there are calls to make; this decides
 * what happens to each one.
 */

const approval = require('../approval');
const memory   = require('../memory');
const settings = require('../settings');
const tools    = require('../tools');
const failures = require('./failures');

/**
 * @param {{ reply: object, schemas: object[], stepDisabled: string[], session: object, signal: AbortSignal,
 *           client?: object, profile?: object, isMission: boolean, step: number,
 *           say: (evt: object) => void, announced: Set<string> }} ctx
 */
/**
 * A person's own turn (CONSTITUTION S1: their request is the decision): a person on the turn, writing themselves — not
 * a paired agent, a mission or a specialist, and not an automatic turn the supervisor started. The Orchestrator's and a
 * work chat's profiles are the conversation a person writes in, so they count; it used to be "no profile at all",
 * which the Orchestrator always has, so a request in the main chat was never applied at once (found 2026-10-07).
 */
function byPerson({ client, isMission, profile, sessionId }) {
  if (!client?.user?.id || client.kind === 'agent' || isMission) return false;
  if (profile && profile.level !== 'orchestrator' && profile.level !== 'work') return false;
  return !require('./lifecycle').isAuto(sessionId);
}

async function runToolCalls({ reply, schemas, stepDisabled, session, signal, client, profile, isMission, step, say, announced }) {
  for (const tc of reply.tool_calls) {
    const name = require('../tools').ALIASES[tc.function?.name] || tc.function?.name || '(unnamed)';   // an old name runs as its new one
    // Stop means the next call too: the rest of this step's calls get a result row (so no call is
    // left without its answer) and do not run (audit 2026-10-04).
    if (signal?.aborted) {
      const result = 'Not run: the turn was stopped before this call.';
      say({ type: 'tool_result', name, result, step });
      memory.append(session.id, { role: 'tool', tool_call_id: tc.id || name, name, content: result });
      continue;
    }
    let args = {};
    try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; }
    catch { args = { _raw: tc.function?.arguments }; }

    // Experiment riskTiers (harness/risk): the call's tier and its way back ride on its event — the trace and the
    // Workstream name them — and a reversible change in a project gets a checkpoint first, taken only once the call is
    // allowed (below), so a refused call writes nothing. Null while it is off.
    const risk = args._raw === undefined ? await require('../risk').before(name, args, { sessionId: session.id, checkpoint: false }) : null;
    say({ type: 'tool_call', name, args, step, ...(risk ? { risk } : {}) });

    // Manual approval, if it is on. The gate is here rather than inside
    // `tools.call` because this is where `say()` is — the question has to
    // reach the transcript the user is looking at — and because it must cover
    // MCP tools, which `tools.call` dispatches before it sees a definition.
    // The conversation's mode first (harness/modes.js): Plan and Ask run nothing that changes anything.
    let refused = args._raw === undefined ? require('../modes').refusal(session.id, tc) : null;
    // The person's level first (auth/permits.js): what it does not allow, and no grant covers, is refused
    // with who could grant it; a level that asks forces the question below.
    const missionId = isMission ? require('../../agents/missions').forSession(session.id)?.id : null;
    const permit = args._raw === undefined ? require('../../auth/permits').tool({ person: client?.user, profile, missionId, sessionId: session.id, name, args }) : { allowed: true };
    if (!permit.allowed && refused === null) refused = `Refused: ${permit.why}. An admin, or someone holding delegate, can grant it in Settings → Users`
      + `${isMission ? '; the agent that dispatched this mission can grant it for the mission with permission_grant' : ''}.`;
    const gate = args._raw === undefined && refused === null ? approval.gate(name, args, { sessionId: session.id, signal, mission: isMission, forceAsk: permit.ask, risk }) : null;
    if (gate) {
      if (isMission) {
        refused = approval.missionRefusal(gate);
        say({ type: 'approval', step, state: 'refused', tool: name, ...gate });
      } else {
        const { id, answer } = approval.askAnywhere({ ...gate, personId: client?.user?.id || null }, { sessionId: session.id, signal, client });
        say({ type: 'approval', step, state: 'asked', id, ...gate });
        const decision = await answer;
        say({ type: 'approval', step, state: 'answered', id, decision, tool: name });
        // Anything that is not one of the three yeses — a denial, a timeout,
        // a stopped turn — stops the call and says which it was.
        if (!['once', 'always', 'always_tool'].includes(decision))
          refused = approval.refusal(decision, gate);
      }
    }

    if (refused === null && risk) await require('../risk').keep(risk);   // allowed: now its checkpoint

    // What a tool put in front of the user (show_image). It travels as its own
    // event and is kept on the tool row, so a reloaded transcript draws it
    // again; the model only ever reads the result text.
    const shown = [];
    const tiers = require('./tool-tiers');
    const result = failures.note(signal, name, args, refused !== null
      ? refused
      : args._raw !== undefined
      ? `Error: could not parse the arguments as JSON: ${args._raw}`
      : !schemas.some(sc => sc.function.name === name) && !tiers.heldNotSent(name, stepDisabled)
        ? `Error: the "${name}" tool is switched off for this conversation.`
        : await tools.call(name, args, stepDisabled, { show: image => shown.push(image), emit: evt => say({ ...evt, step }), sessionId: session.id, signal, approved: !!gate, user: client?.user, screen: require('../screen-proposals').screenOf(client), airlock: !!profile?.airlock,
          // A person's own turn (S1: their request is the decision) — not an automatic turn, a mission or a specialist.
          byPerson: byPerson({ client, isMission, profile, sessionId: session.id }) }));
    tiers.afterCall(session.id, profile, name, result, stepDisabled);   // toolTiers: what was called or read about stays loaded
    for (const image of shown) say({ type: 'image', image, step });
    say({ type: 'tool_result', name, result, step, ...failures.typed(result) });

    memory.append(session.id, {
      role: 'tool', tool_call_id: tc.id || name, name, content: result, ...failures.typed(result),
      ...(shown.length ? { images: shown } : {}),
    });

    // A settings proposal is the one tool result the user has to act on, so it
    // travels as its own event and the console draws it as a card with buttons
    // rather than as one more line of tool output to scroll past.
    for (const proposal of settings.list().pending) {
      if (announced.has(proposal.id)) continue;
      announced.add(proposal.id);
      say({ type: 'proposal', proposal });
    }
  }
}

module.exports = { byPerson, runToolCalls };
