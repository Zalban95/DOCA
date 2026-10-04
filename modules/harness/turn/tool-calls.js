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
async function runToolCalls({ reply, schemas, stepDisabled, session, signal, client, profile, isMission, step, say, announced }) {
  for (const tc of reply.tool_calls) {
    const name = tc.function?.name || '(unnamed)';
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

    say({ type: 'tool_call', name, args, step });

    // Manual approval, if it is on. The gate is here rather than inside
    // `tools.call` because this is where `say()` is — the question has to
    // reach the transcript the user is looking at — and because it must cover
    // MCP tools, which `tools.call` dispatches before it sees a definition.
    let refused = null;
    const gate = args._raw === undefined ? approval.gate(name, args, { sessionId: session.id, signal, mission: isMission }) : null;
    if (gate) {
      if (isMission) {
        refused = approval.missionRefusal(gate);
        say({ type: 'approval', step, state: 'refused', tool: name, ...gate });
      } else {
        const { id, answer } = approval.askAnywhere(gate, { sessionId: session.id, signal, client });
        say({ type: 'approval', step, state: 'asked', id, ...gate });
        const decision = await answer;
        say({ type: 'approval', step, state: 'answered', id, decision, tool: name });
        // Anything that is not one of the three yeses — a denial, a timeout,
        // a stopped turn — stops the call and says which it was.
        if (!['once', 'always', 'always_tool'].includes(decision))
          refused = approval.refusal(decision, gate);
      }
    }

    // What a tool put in front of the user (show_image). It travels as its own
    // event and is kept on the tool row, so a reloaded transcript draws it
    // again; the model only ever reads the result text.
    const shown = [];
    const result = failures.note(signal, name, args, refused !== null
      ? refused
      : args._raw !== undefined
      ? `Error: could not parse the arguments as JSON: ${args._raw}`
      : !schemas.some(sc => sc.function.name === name)
        ? `Error: the "${name}" tool is switched off for this conversation.`
        : await tools.call(name, args, stepDisabled, { show: image => shown.push(image), sessionId: session.id, signal, approved: !!gate, user: client?.user, airlock: !!profile?.airlock }));
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

module.exports = { runToolCalls };
