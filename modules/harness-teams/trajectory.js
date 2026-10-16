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

// Commands that read, or only record what is already there: after the test, these leave its verdict standing.
const READS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'pwd', 'echo', 'find', 'stat', 'file', 'diff', 'true']);
const GIT_READS = new Set(['status', 'diff', 'log', 'show', 'add', 'commit', 'branch', 'rev-parse']);
/** Whether a command could change the work: anything but plain reads, git's own bookkeeping, or a redirection-free line. */
function changes(command) {
  const c = String(command || '');
  if (/[`<>]|\$\(/.test(c)) return true;
  return c.split(/&&|\|\||;|\||\n/).map(x => x.trim()).filter(Boolean).some(seg => {
    const [verb, sub] = seg.split(/\s+/);
    return verb === 'git' ? !GIT_READS.has(sub) : !READS.has(verb);
  });
}

/**
 * Every command it ran, in order, with its return code (null: no code came back) — what tries-score.js reads a test's
 * verdict from (`[{command, code, changes}]`). Commands and observations pair in order, as the trajectory writes them.
 */
function runs(text) {
  let data;
  try { data = JSON.parse(String(text || '')); } catch { return null; }
  const msgs = Array.isArray(data?.messages) ? data.messages : [];
  const out = [], pending = [];
  msgs.forEach((m, i) => {
    if (i < 2) return;
    if (m.role === 'assistant') for (const a of m.extra?.actions || []) if (a?.command) pending.push(String(a.command));
    if ((m.role === 'tool' || m.role === 'user') && pending.length) {
      const command = pending.shift();
      const rc = /<returncode>\s*(-?\d+)\s*<\/returncode>/.exec(textOf(m.content));
      const code = rc ? Number(rc[1]) : Number.isInteger(m.extra?.returncode) ? m.extra.returncode : null;
      out.push({ command: command.slice(0, 400), code, changes: changes(command) });
    }
  });
  return out.slice(-300);
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
  if (!relay.offered().length) throw bad(`${row.label} uses this hub's own model through the model relay, and the relay offers none: choose ${require('../branding').name('product')}'s model (Controls → ${require('../branding').name('product')} ⚙) or list models in Field → API keys → Model relay.`, 409);
  const computers = require('../computers'), rc = require('../relay/computer');
  let rec = computers.get(c.id);
  // Switched on as part of the decision to run it — the person's yes (ask) or its switch (free); said with the computer's name.
  if (!rec?.relayOn || !rec.relayToken) { await rc.set(c.id, true, why || `${row.label} works in it on this hub's model`); rec = computers.get(c.id); }
  const v = rc.vars(rec);
  return { ...v, OPENAI_API_BASE: v.OPENAI_BASE_URL };   // litellm reads either name
}

/**
 * The trajectory as text a person may read, with nothing secret in it — the same rule as its live events (worker.js
 * scrub), and wider, since a whole file outlives the run as an attachment: the values given (the relay token, a
 * provider key) and every secret DOCA keeps (secrets-kept.js) become [key]; then the masking rules for what looks like
 * a secret by its name — NAME_TOKEN=…, a bearer value, "api_key": "…", token: … (machines/busy-read.js maskCommand).
 */
async function scrub(text, given = []) {
  const { MASK } = require('../secrets-mask');
  let kept = [];
  try { kept = await require('../secrets-kept').values(); } catch { /* none readable */ }
  const values = [...new Set([...given, ...kept].filter(v => typeof v === 'string' && v.length >= 4))].sort((a, b) => b.length - a.length);
  const plain = t => values.reduce((s, v) => s.split(v).join('[key]'), String(t ?? ''))
    .replace(/\b([A-Za-z_]\w*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD)\w*=)[^\s'"\\]+/gi, `$1${MASK}`)              // NAME_TOKEN=…
    .replace(/(\bbearer\s+)[^\s'"\\]+/gi, `$1${MASK}`)                                                           // Authorization: Bearer …
    .replace(/(\b(?:token|key|secret|password|passwd)\s*[=:]\s*)(?!\[key\])[^\s'"\\,}]+/gi, `$1${MASK}`);   // token: …
  const named = k => /token|key|secret|password|passwd|credential/i.test(k);
  // A trajectory is JSON: its strings are read decoded (a "\n" before a word is a line break, not an "n"), and a value
  // under a secret's name (api_key, …) is masked whole. Text that is not JSON is scrubbed as it stands.
  const walk = v => (typeof v === 'string' ? plain(v) : Array.isArray(v) ? v.map(walk)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' && named(k) && x ? MASK : walk(x)])) : v);
  let data;
  try { data = JSON.parse(text); } catch { return plain(text); }
  return JSON.stringify(walk(data), null, 2);
}

/** Keep a finished worker's trajectory as an attachment, scrubbed first; its name, or null when there is nothing. */
async function keep(text, { given = [], name = 'trajectory.traj.json', from = null } = {}) {
  if (!String(text || '').trim()) return null;
  const clean = await scrub(text, given);
  return require('../attachments').save(Buffer.from(clean), name, from ? { from } : {}).name;
}

module.exports = { read, observation, runs, changes, relayEnv, scrub, keep };
