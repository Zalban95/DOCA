'use strict';

/**
 * The transcript as the model sees it: tool output clipped (the rest
 * spilled to a file the agent can read), tool calls paired with their results.
 */

const fs   = require('fs');
const path = require('path');
const attachments = require('../../attachments');
const store       = require('../../store');

const TOOL_MAX_CHARS = 16000;
const TOOL_HEAD = 12000;
const TOOL_TAIL = 3000;

function safeSpillPart(s, max) {
  return String(s || 'tool').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'tool';
}

/** Write one tool result so a clipped prompt can still retrieve it with read_file. */
function spillTool(sessionId, row) {
  const dir = store.dir(path.join('harness/tool-results', sessionId || 'anon'));
  const file = path.join(dir,
    `${safeSpillPart(row.tool_call_id || row.at, 48)}-${safeSpillPart(row.name, 32)}.txt`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, String(row.content ?? ''), 'utf8');
  return file;
}

/**
 * The one form a tool result can take, decided by the row and nothing else.
 *
 * `spill` is a callback rather than a path because only the clipped branch
 * needs a file written, and a row that passes through whole should not leave
 * one behind.
 */
function clipToolContent(content, spill, max = TOOL_MAX_CHARS) {
  const s = String(content ?? '');
  if (s.length <= max) return s;
  const file = spill();
  // The old proportions (12000 + 3000 of 16000) at any size: most of the head, a little of the end.
  const head = max === TOOL_MAX_CHARS ? TOOL_HEAD : Math.floor(max * 0.75);
  const tail = max === TOOL_MAX_CHARS ? TOOL_TAIL : Math.floor(max * 0.19);
  const lines = s.split('\n').length;
  return `${s.slice(0, head)}\n… [full output: ${file} — ${s.length} characters, ${lines} lines; shown: the first ${head} and the last ${tail}. `
    + `read_file to retrieve the rest (offset, maxLength)]\n${s.slice(-tail)}`;
}

/**
 * How big a result is sent (lean context, harness.config.doca.resultChars; AGENTS.md "Lean context per step").
 *
 * Without `resendChars` the rule is the old one: every result over TOOL_MAX_CHARS clipped, on every step. With it, a
 * result is sent whole on the step it arrives — the agent never receives less than the tool handed back (the tool's
 * own runaway guard, MAX_OUT, still applies) — and as head + tail + the spill file's path on every later step.
 * `read_file` keeps TOOL_MAX_CHARS on re-sends: a file the agent asked for, within maxLength, is what it is working on.
 * The form changes once, from fresh to re-sent, and is then fixed, so the prefix cache breaks only at the newest
 * results — the ones sent uncached a step ago anyway — never further up (ISSUES.md H-9b).
 */
function maxFor(row, fresh, resendChars, capChars) {
  // A skill read goes whole every time (skills.js bounds it): it is the procedure the turn is following (skill-steps.js).
  if (require('./skill-steps').isRead(row)) return capChars > 0 ? Math.min(require('../toolbox/common').MAX_OUT, capChars) : require('../toolbox/common').MAX_OUT;
  const base = !(resendChars > 0) ? TOOL_MAX_CHARS : fresh ? require('../toolbox/common').MAX_OUT
    : row.name === 'read_file' ? Math.max(resendChars, TOOL_MAX_CHARS) : resendChars;
  // On a model whose window is known, never more than its share of it (step-ceiling.resultCapChars): two whole 64k
  // results in one step would overflow a 32k local model.
  return capChars > 0 ? Math.min(base, capChars) : base;
}

/**
 * Send calls and results only in pairs, dropping either half that has lost the
 * other.
 *
 * `memory.foldBoundary` is what keeps a group on one side of every cut; this is
 * the backstop, because the cost of one broken pair getting through is a provider
 * rejecting *every* subsequent request in the session, and half a pair says
 * nothing to a model anyway — a result whose call is gone is an answer with the
 * question torn off.
 *
 * Both directions happen. A cut through a group leaves the results without the
 * call; a turn that stops between the call and the result — Stop, a crash, an
 * aborted step — leaves the call without its results, which strict providers
 * reject just as firmly. An assistant row that loses every call keeps whatever it
 * said and goes as ordinary text, or is dropped when it said nothing at all.
 */
function pairedRows(rows) {
  const list = rows || [];
  // The same fallback the result row was written with: a provider that sends no
  // call id has its results filed under the tool's name, and matching on `id`
  // alone would read every one of those pairs as two orphans.
  const callId = c => c.id || c.function?.name || '(unnamed)';
  const answered = new Set(list.filter(r => r.role === 'tool').map(r => r.tool_call_id));
  const out = [];
  let open = new Set();
  for (const r of list) {
    if (r.role === 'tool') {
      if (open.has(r.tool_call_id)) out.push(r);
      continue;
    }
    // A call is answered within the step that made it or not at all, so any
    // other row closes the group.
    open = new Set();
    if (r.role === 'assistant' && r.tool_calls?.length) {
      const kept = r.tool_calls.filter(c => answered.has(callId(c)));
      if (kept.length) {
        open = new Set(kept.map(callId));
        out.push({ ...r, tool_calls: kept });
      } else if (String(r.content || '').trim()) {
        out.push({ ...r, tool_calls: undefined });
      }
      continue;
    }
    out.push(r);
  }
  return out;
}

/**
 * Transcript rows → the message array the API expects.
 *
 * Tool output is kept in full on disk and clipped here. Clipping anything over
 * TOOL_MAX_CHARS is what stops a long session from re-sending every `read_file`
 * it ever did; the spill file is how the model gets the rest.
 *
 * What matters beyond the clipping itself is that it is **stable**: the same
 * row produces the same string on every call, so the message array is
 * append-only and a prefix cache can follow it. `test/harness.test.js` pins
 * that — an old result sent once verbatim must still be verbatim after new
 * results arrive.
 */
function toApiMessages(allRows, { sessionId, provider, resendChars, capChars } = {}) {
  const rows = pairedRows((allRows || []).filter(r => r.role !== 'note'));   // DOCA's own notes (important/) are the person's, never the model's
  // Results after the last assistant row are this step's own: the model has not seen them yet.
  const freshFrom = rows.map(r => r.role).lastIndexOf('assistant') + 1;

  // A field a provider sent is put back for the provider that sent it, and for
  // no one else.
  //
  // DeepSeek's thinking mode returns `reasoning_content` beside `content`, and
  // for any request carrying tools it demands the field returned on every
  // assistant message of that conversation, 400ing the turn when it is missing
  // (ISSUES.md H-10). Everyone else either ignores it or has never heard of it,
  // and a body carrying an unknown field is a refusal from a strict endpoint —
  // so the row's own record of who produced it decides, never the model name.
  // The browser may preview the stored reasoning; echoing it to a model is
  // restricted to the provider that produced it.
  // Long reasoning goes as head + tail with its file under lean context (turn/reasoning-resend.js): echoed whole on every
  // step, one long thought was most of a long turn's request.
  const echo = r => (r.role === 'assistant' && r.reasoning?.text && r.reasoning.provider === provider
    ? { reasoning_content: require('./reasoning-resend').text(r, { sessionId, resendChars }) } : {});

  return rows.map((r, i) => {
    if (r.role === 'tool') {
      // Each row decides its own form, so appending a result cannot change how
      // an earlier one is sent. See the note on TOOL_MAX_CHARS.
      const content = clipToolContent(r.content, () => spillTool(sessionId, r), maxFor(r, i >= freshFrom, resendChars, capChars));
      return { role: 'tool', tool_call_id: r.tool_call_id, name: r.name, content };
    }
    // A call stored cut off by an older version is sent whole (turn/cut-calls.js): replayed broken, a provider that parses
    // every earlier call refuses each later request, and the conversation never recovers.
    if (r.role === 'assistant' && r.tool_calls?.length)
      return { role: 'assistant', content: r.content || null, tool_calls: require('./cut-calls').repair(r.tool_calls), ...echo(r) };
    // Attachments are rendered here and stored separately on the row, the same
    // split `from` uses — but the opposite decision about the model. Provenance
    // is metadata and stays off the text; a file the user attached is part of
    // what they said, and a path they can see in the composer and the model
    // cannot is a conversation at cross purposes.
    // `echo` checks the role itself, so a user or tool row cannot pick up a
    // field by being shaped like an assistant one.
    return { role: r.role, content: (r.content || '') + attachments.note(r.attachments) + require('../skill-next').note(r), ...echo(r) };   // skills for this request (skill-next.js)
  });
}

/**
 * The same messages with every echoed field removed.
 *
 * Used on the one path where the messages outlive the choice of provider: a hop
 * down the fallback chain. They were built for one provider, and the field in
 * them answers a rule that provider has and the next one may not.
 */
function withoutEcho(messages) {
  return messages.map(m => {
    if (!m || m.reasoning_content === undefined) return m;
    const { reasoning_content: _dropped, ...rest } = m;
    return rest;
  });
}

module.exports = { toApiMessages, withoutEcho, spillTool, TOOL_MAX_CHARS };
