'use strict';

/**
 * A running job's plan, shared between the worker that carries it out and the person who asked for it (experiment
 * alwaysFree; the design "Always free" §3.4, phase 1). `session.plan` stays what every reader knows — `steps` a list
 * of sentences, `progress` keyed by 1-based step — and gains:
 *
 *   state 'living'   a handed-on job's plan: its go-ahead is the request itself, so no approval is asked
 *   version          +1 on every write (organization.plan), so a stale rewrite can be told apart
 *   from             per step, who asked for it: 'person' (through the main chat), 'worker', 'orchestrator'
 *   edits            the log of who changed what and when — the last EDITS_KEEP — each with `readAt` once the worker
 *                    has read it; a person's edit not yet read is the plan's flagged change (the plan view and the
 *                    main chat's "In the background" block show it)
 *
 * Steps are only ever appended, never reordered, so a worker's `progress {step}` never lands on the wrong one. A
 * cancelled step stays in place (progress 'cancelled') and no longer counts as open. The owner's answer of 2026-10-12:
 * "just flag a changed plan; the agent can adapt to fulfil the new contract if inherent, otherwise deploy a separate
 * agent and a new plan if necessary" — so a person's addition goes straight in, flagged, with no new approval; the
 * worker is told before its next step and either takes it into its plan (change, add) or moves it to a work chat of
 * its own (`split`).
 */
const memory = require('./memory');
const crypto = require('crypto');

const EDITS_KEEP = 30, MAX_STEPS = 30, PER_MINUTE = 5, REOPEN_MS = 30 * 60e3;
const short = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const error = (message, status = 409) => Object.assign(new Error(message), { status });
const FINAL = ['done', 'failed', 'blocked', 'question'];

/** The plan a forked job starts with: one step, the request (fork.js). */
function seed(id, { title, request, by = null }) {
  const plan = { title: short(title, 200), steps: [short(`Do what was asked: ${request}`, 300)], from: ['person'], progress: {},
    note: '', state: 'living', revision: 1, version: 1, edits: [], updatedAt: new Date().toISOString(),
    ...(by?.id ? { by: by.id } : {}) };
  memory.updateSession(id, { plan });
  return plan;
}

const open = (plan, n) => !['done', 'cancelled'].includes(plan.progress?.[n]);
const fromOf = (plan, i) => plan.from?.[i] || 'worker';

/** Whose words a step is in, for the plan's readers: "added by you" and the like. */
const mark = (plan, i) => (fromOf(plan, i) === 'person' ? 'added by the person' : null);

/** The person's edits the worker has not read yet: the plan's flagged change. */
const unread = plan => (plan?.edits || []).filter(e => e.by === 'person' && !e.readAt);

/**
 * One edit — add, change, cancel or split — from the worker (`by: 'worker'`, work_plan) or the person through the
 * main chat (`by: 'person'`, background). Returns { plan, edit, note? }. organization.plan stores it and reports it.
 */
function edit(old, { action, text, step, why, contract }, { by = 'worker', who = null, sessionId } = {}) {
  const s = memory.getSession(sessionId) || {};
  const plan = old ? { ...old, steps: [...old.steps], from: old.steps.map((_, i) => fromOf(old, i)), edits: [...(old.edits || [])], progress: { ...(old.progress || {}) } }
    : { title: short(s.title || 'Work', 200), steps: [], from: [], edits: [], progress: {}, note: '', state: 'living', revision: 1 };
  if (by === 'person') {
    const recent = plan.edits.filter(e => e.by === 'person' && Date.now() - Date.parse(e.at) < 60e3);
    if (recent.length >= PER_MINUTE) throw error(`${PER_MINUTE} changes to this job's plan in the last minute: let it catch up first.`, 429);
  }
  const n = Number(step);
  const valid = () => { if (!Number.isInteger(n) || n < 1 || n > plan.steps.length) throw error(`No step ${step}: the plan has ${plan.steps.length}.`, 400); };
  let note = null;
  if (action === 'add') {
    const t = short(text, 300);
    if (!t) throw error('Adding a step needs its text.', 400);
    if (plan.steps.length >= MAX_STEPS) throw error(`The plan already has ${MAX_STEPS} steps.`, 400);
    plan.steps.push(t);
    plan.from.push(by);
    if (contract && by === 'worker') {
      const c = require('./plan-contracts').split({ title: t, ...contract }).contract;
      plan.contracts = [...(plan.contracts || plan.steps.slice(0, -1).map(() => null)), c || null];
    } else if (plan.contracts) plan.contracts = [...plan.contracts, null];
  } else if (action === 'change') {
    valid();
    if (by !== 'worker') throw error('Only the work chat changes a step; a person adds or cancels one.', 403);
    if (plan.progress[n] && plan.progress[n] !== 'queued') throw error(`Step ${n} is ${plan.progress[n]}: only a step not started yet changes.`);
    if (text) plan.steps[n - 1] = short(text, 300);
    if (contract) {
      const c = require('./plan-contracts').split({ title: plan.steps[n - 1], ...contract }).contract;
      plan.contracts = plan.steps.map((_, i) => (i === n - 1 ? c || null : plan.contracts?.[i] || null));
    }
  } else if (action === 'cancel' || action === 'split') {
    valid();
    if (!open(plan, n)) throw error(`Step ${n} is already ${plan.progress[n]}.`);
    if (action === 'split' && by !== 'worker') throw error('Only the work chat moves a step to a job of its own.', 403);
    if (by === 'person' && plan.progress[n] === 'running') note = 'asked';   // never cancelled under the worker: it is asked
    else plan.progress[n] = 'cancelled';
  } else throw error('Unknown plan edit.', 400);
  const e = { id: `e_${crypto.randomBytes(4).toString('hex')}`, at: new Date().toISOString(), by, ...(who ? { who: short(who, 80) } : {}), action,
    step: action === 'add' ? plan.steps.length : n, text: plan.steps[(action === 'add' ? plan.steps.length : n) - 1],
    ...(why ? { why: short(why, 300) } : {}), ...(note ? { asked: true } : {}), ...(by !== 'person' ? { readAt: new Date().toISOString() } : {}) };
  plan.edits = [...plan.edits, e].slice(-EDITS_KEEP);
  return { plan, edit: e, note };
}

/** Stamp a person's edit read: the worker's turn took it. */
function markRead(id, editId) {
  const s = memory.getSession(id);
  if (!s?.plan?.edits?.some(e => e.id === editId && !e.readAt)) return;
  memory.updateSession(id, { plan: { ...s.plan, edits: s.plan.edits.map(e => (e.id === editId ? { ...e, readAt: new Date().toISOString() } : e)) } });
}

/** What the worker is told before its next step, for a person's edit. */
function message(e, who = 'The person') {
  if (e.action === 'add') return `[plan] ${who} added step ${e.step} through the main chat: "${e.text}". It is in your plan, flagged as theirs. `
    + `If it belongs to this job, adapt your plan to fulfil it — work_plan change {step: ${e.step}} to give it a contract, or add the steps it needs — `
    + `and carry it out with the rest. If it does not belong to this job, move it to a work chat of its own with work_plan split {step: ${e.step}, why}, `
    + 'and say so in one line.';
  if (e.asked) return `[plan] ${who} asks, through the main chat, to cancel step ${e.step} ("${e.text}"), which you are on: stop it at a sensible point and mark it with work_plan cancel {step: ${e.step}, why}.`;
  return `[plan] ${who} cancelled step ${e.step} ("${e.text}") through the main chat: leave it out.`;
}

/**
 * Hand a person's edit to the worker: read before its next step while it works (inbox.js), or a turn now — a job that
 * ended under REOPEN_MS ago reopens for it. Refused for a job a person stopped or one long finished.
 * @returns {'reading'|'started'|'queued'}
 */
function tell(id, e, who) {
  const organization = require('./organization'), agent = require('./agent');
  const s = organization.session(id), job = s.job || {};
  if (['stopped', 'dropped'].includes(job.state)) throw error(`"${s.title}" is ${job.state}: restart it first (work_chats restart), or start a new job.`);
  const ended = FINAL.includes(job.state) || job.state === 'stalled';
  if (ended && Date.now() - Date.parse(job.at || s.updatedAt || 0) > REOPEN_MS)
    throw error(`"${s.title}" finished more than ${REOPEN_MS / 60e3} minutes ago: start a new job for this instead.`);
  const text = message(e, who);
  if (ended) { organization.start(id, text, memory.mainSession().id); markRead(id, e.id); return 'started'; }
  const r = agent.send({ sessionId: id, message: text, client: { name: 'Delegated by Orchestrator', kind: 'agent' } }, { onRead: () => markRead(id, e.id) });
  if (r.queued) return 'queued';
  r.catch?.(() => { /* the runner records failure and reports it upward */ });
  markRead(id, e.id);
  return 'started';
}

/** A step the worker found is not this job's: a work chat of its own, under the main chat, for the same person. */
function split(workerId, e) {
  const main = memory.mainSession();
  const owner = require('./session-access').ownerOf(workerId);
  const person = owner ? { id: owner, orgId: memory.getSession(workerId)?.person?.orgId } : null;
  const made = require('./fork').make({ session: main, message: e.text.replace(/^Do what was asked: /, ''), person });
  require('./organization').report(workerId, 'progress', `Step ${e.step} ("${e.text}") is not this job's${e.why ? ` — ${e.why}` : ''}: moved to its own work chat "${made.title}" (${made.chat.id}).`);
  return { sessionId: made.chat.id, title: made.title, waiting: made.waiting };
}

module.exports = { seed, edit, tell, split, markRead, message, mark, unread, open, EDITS_KEEP, PER_MINUTE, REOPEN_MS };
