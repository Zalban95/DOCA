'use strict';

/**
 * The end-of-work check: mechanical, not a question to the model.
 *
 * When a work chat bound to a project reports its job "done", this runs before
 * the report is accepted:
 *   - its plan: every step done, or blocked (deferred with its reason) —
 *     a step still queued or running is work not finished;
 *   - the project's tests: its `test` command is run, not claimed, and must
 *     exit 0. Tests that cannot run here (a toolchain is missing) or do not
 *     exist are said in the report rather than failing it: they are a fact
 *     about the machine, not about the work;
 *   - what changed: the files git sees changed, listed for whoever reads the
 *     report.
 * A failed check goes back to the work chat as a list of failures; after
 * MAX_ROUNDS it goes up as "blocked", with them. Context drift is caught by
 * comparing the work with the plan and the tree, not by asking the drifted
 * context whether it drifted.
 */
const projects = require('./store');

const MAX_ROUNDS = 3;
const TEST_WAIT_SEC = 900;

/** The command that tests this project: "test", else the first "<kind>:test". */
function testCommand(commands) {
  return commands.find(c => c.name === 'test') || commands.find(c => /:test$/.test(c.name)) || null;
}

/**
 * { ok, failures: [string], notes: [string] } for a work chat saying "done".
 * A work chat outside any project has only its plan checked.
 */
async function check(session) {
  const failures = [], notes = [];

  const plan = session.plan;
  if (plan?.steps?.length) {
    const open = plan.steps.map((s, i) => ({ n: i + 1, s, state: plan.progress?.[i + 1] || 'queued' }))
      .filter(x => x.state === 'queued' || x.state === 'running');
    if (open.length) failures.push(`Plan steps not done: ${open.map(x => `${x.n}. ${x.s} (${x.state})`).join('; ')}. Finish them, or mark them blocked with the reason (work_plan progress).`);
    const deferred = plan.steps.filter((s, i) => plan.progress?.[i + 1] === 'blocked');
    if (deferred.length) notes.push(`Deferred plan steps: ${deferred.join('; ')}.`);
  }

  const p = projects.forSession(session.id);
  if (p) {
    const { commands } = await require('./run').commands(p);
    const test = testCommand(commands);
    if (!test) notes.push(`${p.name} has no test command; nothing was run.`);
    else if (test.missing.length) notes.push(`Tests not run: ${test.run} needs ${test.missing.join(', ')}, not installed here.`);
    else {
      const r = await require('./run').run(p.id, test.name, { waitSec: TEST_WAIT_SEC, sessionId: session.id });
      if (r.job.state === 'running') failures.push(`${test.run} was still running after ${TEST_WAIT_SEC / 60} minutes (job ${r.job.id}). Make the tests finish, or report blocked.`);
      else if (r.job.code !== 0) failures.push(`${test.run} failed (exit ${r.job.code}). The end of its output:\n${String(r.output || '').slice(-3000)}`);
      else notes.push(`Tests passed: ${test.run} (exit 0).`);
    }
    try {
      const git = require('./git');
      if (await git.top(p.root)) {
        const st = await git.status(p.root);
        notes.push(st.files.length
          ? `Changed and not committed (${st.files.length}): ${st.files.slice(0, 30).map(f => f.path).join(', ')}${st.files.length > 30 ? ', …' : ''}.`
          : 'Working tree clean.');
      }
    } catch { /* git unreadable: nothing to list */ }
    try { notes.push(...await scope(p, session)); } catch { /* no checkpoint to compare with */ }
  }
  return { ok: failures.length === 0, failures, notes };
}

/** Paths a plan names: file-like tokens (with an extension) and folders ending in "/". */
function namedPaths(plan) {
  const text = [plan?.title, ...(plan?.steps || []), plan?.note].filter(Boolean).join('\n');
  const found = text.match(/(?:[\w.-]+\/)+[\w.-]*|\b[\w-]+\.[a-z][a-z0-9]{0,5}\b/gi) || [];
  return [...new Set(found.map(s => s.replace(/^\.\//, '').replace(/[.,;:]+$/, '')))].filter(s => s && !/^https?:/.test(s));
}

/**
 * What this job changed, and what of that its plan did not name. The baseline
 * is the first checkpoint taken during the job (projects/checkpoints.js — one
 * is taken before every turn), so "changed" means changed by this job, not
 * whatever else is uncommitted. Notes, not failures: a plan names what it
 * means to touch, rarely every file.
 */
async function scope(p, session) {
  const since = session.job?.since;
  const cps = require('./checkpoints').list(p).filter(c => c.sessionId === session.id && (!since || c.at >= since));
  const base = cps.at(-1);   // list() is newest first: the earliest of this job
  if (!base) return [];
  const changed = (await require('./checkpoints').changes(p, base.id)).map(c => c.path);
  if (!changed.length) return ['This job changed no files.'];
  const out = [`Changed during this job (${changed.length}): ${changed.slice(0, 30).join(', ')}${changed.length > 30 ? ', …' : ''}.`];
  const named = namedPaths(session.plan);
  if (named.length) {
    const inPlan = f => named.some(n => f === n || f.endsWith(`/${n}`) || f.startsWith(n.endsWith('/') ? n : `${n}/`) || f.split('/').pop() === n);
    const outside = changed.filter(f => !inPlan(f));
    if (outside.length) out.push(`Outside what the plan named (${outside.length}): ${outside.slice(0, 20).join(', ')}${outside.length > 20 ? ', …' : ''} — say why, or put them back.`);
  }
  return out;
}

/**
 * What a "done" report becomes. Returns { outcome, message, refused? }:
 * the report as filed (with the checks' notes added), or a refusal the work
 * chat reads — and after MAX_ROUNDS refusals, "blocked" upward.
 */
async function review(session, message) {
  const v = await check(session);
  const memory = require('../harness/memory');
  const rounds = (session.job?.doneRefused || 0) + (v.ok ? 0 : 1);
  if (v.ok) {
    memory.updateSession(session.id, { job: { ...(session.job || {}), doneRefused: 0 } });
    return { outcome: 'done', message: [message, v.notes.length ? `Checks: ${v.notes.join(' ')}` : ''].filter(Boolean).join('\n\n') };
  }
  memory.updateSession(session.id, { job: { ...(session.job || {}), doneRefused: rounds } });
  if (rounds < MAX_ROUNDS) return { refused: true, failures: v.failures, notes: v.notes, round: rounds, of: MAX_ROUNDS };
  return { outcome: 'blocked', message: `Reported done ${rounds} times, and the checks still fail:\n- ${v.failures.join('\n- ')}\n\nIts report: ${message}` };
}

module.exports = { check, review, testCommand, namedPaths, scope, MAX_ROUNDS };
