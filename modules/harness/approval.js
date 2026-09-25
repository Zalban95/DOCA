'use strict';

/**
 * Whether a tool call may run, and who says so.
 *
 * Two modes. **auto** is what this harness has always done: the agent calls a
 * tool and the tool runs. **manual** stops each call that does something and
 * asks, with the answer optionally kept — so "yes, git is fine" is said once
 * rather than forty times, while `rm` is still a question every time.
 *
 * Three decisions are load-bearing:
 *
 * **The remembered unit is a tool plus a verb, not a whole tool.** "Always
 * allow shell" is barely a permission system — it is the off switch with extra
 * steps. `shell:git` is a thing a person can actually mean.
 *
 * **A chained command is every verb in it.** `git status && rm -rf ~` leads
 * with `git`, and a gate that read only the first word would wave it through
 * on an allowlist that says nothing about `rm`. Every segment's verb must be
 * allowed, and a command carrying substitution (`$(…)`, backticks) cannot be
 * reduced to verbs at all, so it is always asked about.
 *
 * **The mode is not proposable.** It lives at `harness.approval`, which no
 * `settings.SETTABLE` prefix covers and which `FORBIDDEN` names outright: an
 * agent that can move itself to full auto is not being supervised, it is
 * filling in its own permission slip.
 */
const { loadPrefs, savePrefs } = require('../utils');

/**
 * `unattended` is the third, added 2026-09-25 for machines the owner runs as a
 * test bench: tools run as in auto, and the agent's own proposals — settings
 * and installs, which otherwise wait for a click — are applied the moment they
 * are made (toolbox/settings.js), each one audited. It is the owner's switch
 * alone (routes.js), set only with an explicit confirmation, and like the
 * others it is not proposable. Off on every install unless someone turns it on.
 */
const MODES = ['auto', 'manual', 'unattended'];
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Tools that read DOCA's own state and nothing else.
 *
 * They touch no filesystem outside this app's own store, start no process,
 * and send nothing anywhere — so gating them buys no safety and costs a
 * question every few seconds, which is how a person learns to click Allow
 * without reading. Anything that reads a file, runs a command, reaches the
 * network, writes, or speaks to another machine is deliberately absent.
 */
const FREE = new Set([
  'memory_list', 'memory_search', 'settings_read', 'system_status',
  'mcp_status', 'doca_clients', 'work_chats', 'agent_results',
  'show_media', 'show_image',
]);

/** Which argument carries the command line, per tool that has one. */
const VERB_ARG = { shell: 'command' };

function settings() {
  const a = (loadPrefs().harness || {}).approval || {};
  return {
    mode:   MODES.includes(a.mode) ? a.mode : 'auto',
    always: Array.isArray(a.always) ? a.always.filter(k => typeof k === 'string' && k) : [],
  };
}

function save(patch) {
  const prefs = loadPrefs();
  if (!prefs.harness) prefs.harness = {};
  prefs.harness.approval = { ...settings(), ...patch };
  savePrefs(prefs);
  return settings();
}

function setMode(mode, { role = 'owner', confirm = '' } = {}) {
  if (!MODES.includes(mode)) throw Object.assign(new Error(`mode must be one of: ${MODES.join(', ')}`), { status: 400 });
  if (mode === 'unattended') {
    if (role !== 'owner') throw Object.assign(new Error('Only the owner can turn on unattended mode.'), { status: 403 });
    if (confirm !== 'unattended') throw Object.assign(new Error('Unattended mode needs an explicit confirmation.'), { status: 400 });
  }
  return save({ mode });
}

const isUnattended = () => settings().mode === 'unattended';

/** Remember a decision. Keys are `tool` or `tool:verb`; duplicates collapse. */
function remember(keys) {
  const { always } = settings();
  return save({ always: [...new Set([...always, ...[].concat(keys).filter(Boolean)])].sort() });
}

function forget(key) {
  return save({ always: settings().always.filter(k => k !== key) });
}

/**
 * The verbs a command line runs, or null when that cannot be said.
 *
 * Null is not "none" — it means the string does something this cannot
 * summarise (a substitution that produces the command at run time), and the
 * caller must treat it as unallowable rather than as empty.
 */
function verbsOf(command) {
  const text = String(command || '').trim();
  if (!text) return [];
  if (/\$\(|`/.test(text)) return null;                 // the command is computed, not written

  return text
    .split(/\s*(?:&&|\|\||[;|\n])\s*/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(segment => {
      // `FOO=bar cmd` and `sudo cmd` both hide the real verb behind a word that
      // is not it. Env assignments are skipped; `sudo` is kept, because "always
      // allow sudo anything" is a decision somebody should make on purpose.
      const words = segment.split(/\s+/).filter(Boolean);
      const first = words.find(w => !/^[A-Za-z_]\w*=/.test(w)) || '';
      return first.replace(/^["']|["']$/g, '');
    })
    .filter(Boolean);
}

/** The keys a call must hold to run unasked, or null when it can never. */
function keysFor(name, args) {
  const arg = VERB_ARG[name];
  if (!arg) return [name];
  const verbs = verbsOf(args?.[arg]);
  if (verbs === null) return null;
  if (!verbs.length) return [name];
  return verbs.map(v => `${name}:${v}`);
}

/** A one-line account of what is about to happen, for the card. */
function summarize(name, args) {
  const arg = VERB_ARG[name];
  const line = arg ? String(args?.[arg] || '') : '';
  if (line) return line.length > 400 ? `${line.slice(0, 400)}…` : line;
  try {
    const json = JSON.stringify(args ?? {});
    return json.length > 400 ? `${json.slice(0, 400)}…` : json;
  } catch { return ''; }
}

/**
 * Does this call need a person? Returns null when it may simply run, or the
 * request to put in front of the user.
 */
function gate(name, args) {
  const { mode, always } = settings();
  if (mode !== 'manual') return null;
  if (FREE.has(name)) return null;
  if (always.includes(name)) return null;           // the whole tool was allowed

  const keys = keysFor(name, args);
  if (keys && keys.every(k => always.includes(k))) return null;

  return {
    tool: name,
    // What "always allow" would remember. Null means this call cannot be
    // reduced to a type, so the card offers once-or-deny and nothing else.
    keys,
    summary: summarize(name, args),
  };
}

/* ── Pending questions ────────────────────────────────────
   The same shape `reach.js` uses to ask a person on a device: the call blocks,
   and a question that outlives the turn that asked it is withdrawn rather than
   left on screen offering choices that lead nowhere. */

const _pending = new Map();   // id -> { req, resolve, timer, sessionId, at }
let _seq = 0;

const DECISIONS = ['once', 'always', 'always_tool', 'deny'];

/**
 * Put a request to the user and wait. Resolves to a decision — never rejects,
 * because "nobody answered" is an answer this has to render, not an error that
 * kills the turn.
 */
function ask(req, { sessionId, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const id = `apr_${Date.now().toString(36)}_${(++_seq).toString(36)}`;
  return {
    id,
    answer: new Promise(resolve => {
      const done = decision => {
        const entry = _pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        _pending.delete(id);
        signal?.removeEventListener?.('abort', onAbort);
        resolve(decision);
      };
      const onAbort = () => done('cancelled');
      const timer = setTimeout(() => done('timeout'), timeoutMs);
      if (timer.unref) timer.unref();
      _pending.set(id, { id, req, resolve: done, timer, sessionId, at: new Date().toISOString() });
      if (signal?.aborted) return done('cancelled');
      signal?.addEventListener?.('abort', onAbort, { once: true });
    }),
  };
}

/**
 * Ask the panel and, when the turn came from a device, that device as well.
 *
 * The device that started a turn is often the only place its owner is looking
 * — a watch on a wrist, a phone in a hand — and a permission card drawn in a
 * dashboard nobody has open is a turn that blocks for five minutes and then
 * gives up. So the same question goes to both, and the first answer wins:
 * whichever place did not answer has its copy withdrawn, because a question
 * that outlives the thing it was blocking is worse than no question at all
 * (the rule `reach.ask` already follows on timeout).
 *
 * The wrist gets three options rather than two. **Full auto** is there because
 * the realistic alternative on a small screen is a person tapping Approve
 * forty times, which teaches them to tap without reading — and because the
 * only party who may turn the leash off is the user, who is exactly who is
 * being asked. It is a real escalation and is written down as one: it changes
 * `harness.approval.mode` for the whole panel, not just this call.
 *
 * Returns the decision string, the same vocabulary `decide()` takes.
 */
function askAnywhere(req, { sessionId, signal, client } = {}) {
  const { id, answer } = ask(req, { sessionId, signal });

  // A device turn carries the device's id; the dashboard console does not.
  // `kind: 'agent'` is a paired agent, not a person, and must never be asked
  // to approve on the user's behalf.
  const deviceId = client?.id && client.kind !== 'agent' && client.kind !== 'dashboard' ? client.id : null;
  if (!deviceId) return { id, answer };

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });

  const viaDevice = (async () => {
    try {
      const reach = require('./reach');
      const r = await reach.ask({
        to: [deviceId],
        question: `Allow ${req.tool}?`,
        note: req.summary,
        choices: [
          { id: 'approve',   label: 'Approve' },
          { id: 'deny',      label: 'Deny' },
          { id: 'full_auto', label: 'Full auto' },
        ],
        timeoutSec: 240,
        signal: ctrl.signal,
      });
      if (r.status !== 'answered') return null;          // dismissed, timed out, withdrawn
      if (r.choiceId === 'full_auto') { setMode('auto'); return 'once'; }
      return r.choiceId === 'approve' ? 'once' : 'deny';
    } catch { return null; }                              // no such device, no prompts — the panel still has it
  })();

  // Feed a device answer back through `decide()` so the panel's card settles
  // and the pending entry is cleaned up by the one code path that does that.
  viaDevice.then(d => { if (d) decide(id, d); });
  // And when the panel answers first, take the question off the wrist.
  answer.then(() => ctrl.abort(), () => ctrl.abort());

  return { id, answer };
}

/** Answer one pending request. Returns false if it is already gone. */
function decide(id, decision) {
  if (!DECISIONS.includes(decision))
    throw Object.assign(new Error(`decision must be one of: ${DECISIONS.join(', ')}`), { status: 400 });
  const entry = _pending.get(id);
  if (!entry) return false;

  if (decision === 'always' && entry.req.keys?.length) remember(entry.req.keys);
  if (decision === 'always_tool') remember(entry.req.tool);
  entry.resolve(decision);
  return true;
}

/** Everything still waiting — so a reloaded panel finds the open questions. */
function pending() {
  return [..._pending.values()].map(e => ({ id: e.id, at: e.at, sessionId: e.sessionId, ...e.req }));
}

/** The sentence the model reads when a call did not happen. */
function refusal(decision, req) {
  const what = req.keys?.length ? req.keys.join(', ') : req.tool;
  if (decision === 'timeout')
    return `Not run: this harness is in manual approval mode and nobody answered the request to run "${req.tool}" `
      + 'within five minutes. The question has been withdrawn. Say what you were going to do and why, and let the '
      + 'user start it again — do not retry it on your own.';
  if (decision === 'cancelled')
    return `Not run: the turn was stopped while waiting for approval of "${req.tool}".`;
  return `Refused by the user: "${req.tool}" was not allowed to run (${what}). Do not try to reach the same end by `
    + 'another route — a refusal is about the action, not the wording. Ask what to do instead, or carry on with '
    + 'whatever does not need it.';
}

/**
 * What a mission gets instead of a question.
 *
 * A mission runs unwatched — `ask_device` is in `registry.NEVER` for exactly
 * this reason — so there is no one to put a card in front of. Denying is the
 * conservative half of that: the allowlist still applies, so a specialist can
 * be given the verbs it needs in advance, on purpose.
 */
function missionRefusal(req) {
  return `Not run: this harness is in manual approval mode and "${req.tool}" is not on the standing allowlist. `
    + 'A mission runs unwatched, so there is nobody to ask. Report this as the reason you stopped; the user can '
    + `allow ${req.keys?.length ? req.keys.join(' or ') : req.tool} in Harness → Approvals and start it again.`;
}

/**
 * What the agent is told about its own leash.
 *
 * Only rendered in manual mode, and only into the live block — the allowlist
 * grows mid-turn when the user answers "always allow", so it is a changing
 * reading and must not sit in the cached prefix ahead of the transcript (H-9).
 *
 * It is told for the same reason charter rule 12 makes every limit name
 * itself: an agent that does not know a call will be stopped plans six of them
 * and reports a puzzling failure, where one that knows can say what it needs
 * before it starts.
 */
function block() {
  const { mode, always } = settings();
  if (mode !== 'manual') return '';
  return ['# Approval', 'Manual approval is on: the user is asked before each tool call that does something, '
    + 'and may refuse. A refusal is about the action, not the wording — do not retry it another way.',
    always.length
      ? `Already allowed without asking: ${always.join(', ')}.`
      : 'Nothing is on the standing allowlist yet, so expect to be asked.',
    'Reads of this panel\'s own state never ask. If you need a verb repeatedly, say so — the user can allow it once.',
  ].join('\n');
}

module.exports = {
  MODES, FREE, settings, setMode, isUnattended, remember, forget, block,
  verbsOf, keysFor, gate, ask, askAnywhere, decide, pending, refusal, missionRefusal,
};
