'use strict';

/**
 * What runs behind the main chat, as the main chat sees and steers it (experiment alwaysFree; the design "Always free"
 * §3.5, §3.8). Deterministic — read from the work chats' jobs and plans, never asked of a model:
 *
 *   rows(main)    each background job: its plan's step in progress, what the person added that it has not read yet,
 *                 how long it has run, or how it ended
 *   block(main)   "# In the background" for the Orchestrator's readings, in place of the per-row briefs
 *                 (organization.block), so "how is it going?" needs no tool call
 *   tool          `background {status | add | cancel | stop}` — the front's one place to look at and steer a job; an
 *                 addition goes into the job's living plan and reaches the worker before its next step (living-plan.js)
 */
const memory = require('./memory');

const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const FINAL = ['done', 'failed', 'blocked', 'question'];
const SHOWN_AFTER_MS = 60 * 60e3;   // a finished job stays in view this long, or while its report is unread

function ago(at) {
  const ms = Date.now() - Date.parse(at || 0);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.round(ms / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}

/** Where a plan is: { done, total, at: step number or null, text, state }. */
function where(plan) {
  if (!plan?.steps?.length) return null;
  const live = plan.steps.map((t, i) => ({ n: i + 1, t, st: plan.progress?.[i + 1] || 'queued' })).filter(x => x.st !== 'cancelled');
  const cur = live.find(x => x.st === 'running') || live.find(x => x.st !== 'done');
  return { done: live.filter(x => x.st === 'done').length, total: live.length, at: cur?.n || null, text: cur?.t || '', state: cur?.st || 'done' };
}

/** The main chat's background jobs, newest working first: what `status` and the block draw. */
function rows(mainId = memory.mainSession().id) {
  const org = require('./organization');
  const reports = memory.getSession(mainId)?.reports || [];
  return memory.listSessions().sessions.filter(x => x.kind === 'work' && x.parentId === mainId && !x.archivedAt && x.job).map(x => {
    const s = org.session(x.id), job = s.job, w = where(s.plan);
    const unreadReport = reports.find(n => n.from === s.id && FINAL.includes(n.type) && !n.readAt);
    const ended = FINAL.includes(job.state) || ['stalled', 'stopped', 'dropped'].includes(job.state);
    const theirs = require('./living-plan').unread(s.plan);
    return { id: s.id, title: s.title, state: job.state, running: require('./agent').isRunning(s.id), since: job.since, endedAt: ended ? job.at || s.updatedAt : null,
      ended, plan: w, added: theirs.map(e => ({ step: e.step, action: e.action, text: e.text })), brief: short(s.brief, 200), unread: !!unreadReport,
      version: s.plan?.version || null };
  }).filter(r => !r.ended || r.unread || Date.now() - Date.parse(r.endedAt || 0) < SHOWN_AFTER_MS)
    .sort((a, b) => Number(a.ended) - Number(b.ended) || String(b.since).localeCompare(String(a.since)));
}

/** One job in a line. */
function line(r) {
  const head = `- ${short(r.title, 70)} (${r.id}) — `;
  if (r.ended) return `${head}${r.state.toUpperCase()} ${ago(r.endedAt)} ago${r.brief ? `: "${short(r.brief, 160)}"` : ''}${r.unread ? ' (unread)' : ''}`;
  const step = r.state === 'queued' ? 'lined up, waiting for a free place (work.parallel)'
    : r.state === 'waiting' ? 'waiting for its specialists'
    : r.plan?.at ? `step ${r.plan.at} of ${r.plan.total} ${r.plan.state === 'running' ? 'running' : 'next'}: "${short(r.plan.text, 80)}"` : 'working';
  const added = r.added.length ? ` · ${r.added.map(a => `step ${a.step} ${a.action === 'add' ? 'added' : 'cancelled'} by the person`).join(', ')}, not read yet` : '';
  return `${head}${step}${added} · ${ago(r.since)}`;
}

/** The readings' block, for the Orchestrator. */
function block(mainId) {
  const list = rows(mainId);
  if (!list.length) return ['# In the background', 'Nothing is running behind this chat. A clear job goes to a work chat by itself; `background` steers one that runs.'];
  const working = list.filter(r => !r.ended).length, unread = list.filter(r => r.ended && r.unread).length;
  return [`# In the background (${working} working${unread ? `, ${unread} finished unread` : ''})`, ...list.slice(0, 10).map(line),
    'The person may add to a running job or cancel a step through you: `background add` / `cancel` (it reaches the worker before its next step); `stop` ends a job.'];
}

/** The job a call names, or the only one working; an error naming the choices otherwise. */
function pick(mainId, job) {
  const list = rows(mainId);
  if (job) {
    const r = list.find(x => x.id === job) || list.find(x => x.title.toLowerCase() === String(job).toLowerCase());
    if (r) return r;
    const s = memory.getSession(job);
    if (s?.kind === 'work' && s.parentId === mainId) return { id: s.id, title: s.title };
    throw new Error(`No background job "${job}". ${list.length ? `Running: ${list.map(x => `${x.title} (${x.id})`).join('; ')}.` : 'Nothing runs in the background.'}`);
  }
  const working = list.filter(x => !x.ended);
  if (working.length === 1) return working[0];
  throw new Error(working.length ? `Say which job (job): ${working.map(x => `${x.title} (${x.id})`).join('; ')}.` : 'Nothing runs in the background.');
}

/** `background`'s actions, as the person the turn acts for. Returns the words for the person, rendered from the plan. */
function act(args, ctx) {
  const org = require('./organization'), living = require('./living-plan');
  const main = memory.mainSession().id;
  if (ctx.sessionId !== main) throw new Error('Only the main chat steers background jobs; a work chat edits its own plan with work_plan.');
  if (args.action === 'status' || !args.action) return block(main).join('\n');
  const r = pick(main, args.job);
  if (ctx.user && !require('./session-access').mayUse(ctx.user, r.id)) throw new Error(`No background job "${args.job || r.id}".`);
  const who = ctx.user?.name || null;
  if (args.action === 'stop') {
    const stopped = require('./agent').cancel(r.id);
    const s = memory.getSession(r.id);
    if (!stopped && s?.job && !FINAL.includes(s.job.state)) memory.updateSession(r.id, { job: { ...s.job, state: 'stopped', stoppedWhy: 'stopped by the person, through the main chat' } });
    const w = where(s?.plan);
    return `Stopped **${r.title}**${w?.at ? ` at step ${w.at} of ${w.total}` : ''}. It can be restarted or dropped any time (work_chats restart / drop).`;
  }
  if (args.action === 'add' || args.action === 'cancel') {
    const plan = org.plan(r.id, { action: args.action, text: args.text, step: args.step, why: args.why }, { by: 'person', who });
    const how = living.tell(r.id, plan.edit, who || 'The person', ctx.byPerson ? ctx.user : null);   // their own addition carries their authority
    const w = where(memory.getSession(r.id)?.plan);
    if (args.action === 'cancel') return plan.edit.asked
      ? `Asked **${r.title}** to drop step ${plan.edit.step} ("${short(plan.edit.text, 80)}"), which it is on now: it stops it at a sensible point.`
      : `Cancelled step ${plan.edit.step} of **${r.title}** ("${short(plan.edit.text, 80)}").`;
    const now = w?.at && w.at !== plan.edit.step ? ` It's on step ${w.at} now and` : ' It';
    return `Added to **${r.title}** as step ${plan.edit.step}.${now} ${how === 'queued' ? 'will pick that up after its current step' : 'is reading it now'}.`;
  }
  throw new Error('background: action is status, add, cancel or stop.');
}

const tool = {
  name: 'background',
  description: 'See and steer the jobs running in the background for the person — the main chat\'s one place for them. status lists each job '
    + 'with the step it is on; add puts what the person just asked for into a running job\'s plan, flagged as theirs (the worker reads it before its next '
    + 'step and fits it in, or moves it to a job of its own); cancel drops a step (one being worked on is asked to stop); stop ends a job. '
    + 'Use it for "also …", "skip …", "stop that" and "how is it going" about work that already runs; something new goes to a work chat by itself.',
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['status', 'add', 'cancel', 'stop'] },
    job: { type: 'string', description: 'The job\'s id or title; may be left out when only one is running.' },
    text: { type: 'string', description: 'add: the step, in the person\'s words.' },
    step: { type: 'integer', description: 'cancel: the step number (status shows them).' },
    why: { type: 'string', description: 'cancel: why, in a few words.' },
  }, required: ['action'] },
  run: async (args, ctx) => { try { return act(args, ctx); } catch (e) { return `Error: ${e.message}`; } },
};

module.exports = { rows, block, line, where, act, tool };
