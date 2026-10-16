'use strict';

/**
 * A worker whose CLI writes no event stream but a trajectory file (mini-swe-agent's `-o`, written again after every
 * step: harness/catalog.js `team.output`), read into the same plain kinds as events.js — mechanically, never summarised:
 * a command as it ran it, the first line of what came back with its return code, what it said, and its last words.
 * The relay that gives it DOCA's model is here too (`team.relay`): the computer's relay token, never a provider key.
 *
 * mini-swe-agent's trajectory (format "mini-swe-agent-1.1"): `messages` — system, the task, then per step an assistant
 * message (its reasoning as `content`, its commands as `extra.actions[].command`) and one observation per command
 * (role `tool`, or `user` in its text-based form: "<returncode>N</returncode>\n<output>…</output>"), ending in a message
 * of role `exit` whose `extra.exit_status` is "Submitted" when it finished by itself.
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const first = s => String(s ?? '').split('\n').find(l => l.trim()) || '';
const textOf = c => (Array.isArray(c) ? c.map(x => (typeof x === 'string' ? x : x?.text || '')).join('\n') : String(c ?? ''));

/** One observation: its return code and the first line of its output. */
function observation(content) {
  const t = textOf(content);
  const rc = /<returncode>\s*(-?\d+)\s*<\/returncode>/.exec(t);
  const out = /<output>\n?([\s\S]*?)(<\/output>|$)/.exec(t);
  const line = first(out ? out[1] : t).slice(0, 200);
  return { type: 'result', ok: rc ? Number(rc[1]) === 0 : null, text: line || (rc ? `exit ${rc[1]}` : '') };
}

/**
 * The events in a trajectory's text past the first `seen` messages. Returns {events, seen, final}: `final` once it has
 * its exit message. A file caught half-written reads as nothing new (the next look reads it whole).
 */
function read(text, seen = 0) {
  let data;
  try { data = JSON.parse(String(text || '')); } catch { return { events: [], seen, final: null }; }
  const msgs = Array.isArray(data?.messages) ? data.messages : [];
  const events = [];
  let final = null;
  msgs.forEach((m, i) => {
    if (i < Math.max(seen, 2)) return;   // the system prompt and the task are not its doing
    if (m.role === 'assistant') {
      const said = textOf(m.content).trim();
      if (said) events.push({ type: 'text', text: said });
      for (const a of m.extra?.actions || []) if (a?.command) events.push({ type: 'command', text: String(a.command) });
    } else if (m.role === 'tool' || m.role === 'user') events.push(observation(m.content));
    else if (m.role === 'exit') {
      const status = String(m.extra?.exit_status || data?.info?.exit_status || '');
      const last = [...msgs].reverse().find(x => x.role === 'assistant' && textOf(x.content).trim());
      const words = last ? textOf(last.content).trim() : '';
      final = { type: 'final', ok: status === 'Submitted', text: status === 'Submitted' ? words : `${words}${words ? '\n' : ''}It ended without finishing: ${status || 'no reason given'}${m.content && textOf(m.content) !== status ? ` — ${first(textOf(m.content)).slice(0, 200)}` : ''}.` };
    }
  });
  return { events, seen: msgs.length, final };
}

/**
 * The model relay's variables for the worker's process (`team.relay`): the computer's switch turned on when it is off
 * (as the computer tool's `relay` action does), so its programs use the hub's models. Refused, with where to switch
 * it on, while the owner's relay is off or closed to computers — never a provider key instead.
 */
async function relayEnv(c, row, why = null) {
  if (!row.team?.relay) return {};
  const relay = require('../relay');
  if (!relay.enabled() || !relay.forComputers()) throw bad(`${row.label} uses this hub's own model through the model relay, which is ${relay.enabled() ? 'not open to agents\' computers' : 'off'}: `
    + 'its owner switches it on in Field → API keys → Model relay. Then try the task again (team keep_going).', 409);
  if (!relay.offered().length) throw bad(`${row.label} uses this hub's own model through the model relay, and the relay offers none: choose DOCA's model (Controls → DOCA ⚙) or list models in Field → API keys → Model relay.`, 409);
  const computers = require('../computers'), rc = require('../relay/computer');
  let rec = computers.get(c.id);
  // Switched on as part of the decision to run it — the person's yes (ask) or its switch (free); said with the computer's name.
  if (!rec?.relayOn || !rec.relayToken) { await rc.set(c.id, true, why || `${row.label} works in it on this hub's model`); rec = computers.get(c.id); }
  const v = rc.vars(rec);
  return { ...v, OPENAI_API_BASE: v.OPENAI_BASE_URL };   // litellm reads either name
}

module.exports = { read, observation, relayEnv };
