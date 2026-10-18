'use strict';

/**
 * Scoring tries mechanically (tries.js; improvement D2): what a person would look at, read from records and files —
 * never from a model's opinion.
 *
 *   checks    every check of the task (its contract's and `checks`), run where the try worked; held of total, and the
 *             first that failed in its own words ("text over text at 17 s")
 *   test      the task's test command (`test`), as the try last ran it itself — in its own conversation, under its own
 *             approvals (a shell call, the project tool's run, a background job: test-runs.js says which count), or for an
 *             outside harness the command its trajectory records with its return code (harness-teams/trajectory.js
 *             `runs`): passed, failed, or not known (never run, or run before a later change). The hub never
 *             runs it: a check never runs a command (plan-contracts.js), so a test cannot become a way around the approvals.
 *   failures  the try's failed calls (results that begin "Error")
 *   cost      tokens spent, then time — tie-breakers only
 *
 * A try is eligible when it finished, every check held and its test did not fail; the best eligible try is kept.
 */

/** The task's checks: its contract's, then `checks`. */
const checksOf = t => [t.contract?.check, ...(Array.isArray(t.checks) ? t.checks : [])].filter(Boolean);

const norm = c => String(c ?? '').trim().replace(/\s+/g, ' ');
// How a run of the test is read from a transcript is test-runs.js: a bare run, a `cd` into its own folder, a pipe into a
// filter read by the runner's summary, the project tool's run, a background job.
const runs = () => require('./test-runs');
/** Whether a command line runs exactly the test (output redirections aside). */
const isTestRun = (command, test, root = null) => runs().shape(command, test, root) === 'exact';
/** The test's verdict from commands in order: the last run of it decides, unless a change came after it. */
const fromRuns = (test, list, where, opts) => runs().verdict(test, list, where, opts);
/** A try on the hub: its own conversation's commands, as `fromRuns` reads them. */
const hubRuns = (rows, test = null) => runs().fromRows(rows, test);

/** What the try's own record says of its test: { state: passed|failed|unknown, why }. */
function testEvidence(t, sessionId, root = null) {
  if (!t.test) return null;
  const want = norm(t.test);
  if (require('./outside').isOutside(t.agent)) {   // an outside harness: the commands its worker kept from its trajectory
    const w = (() => { try { return require('../harness-teams/store').byMission(t.missionId); } catch { return null; } })();
    if (!Array.isArray(w?.runs)) return { state: 'unknown', why: `the hub keeps no exit codes of ${w?.label || 'this harness'}'s commands, so whether \`${want}\` passed is not known` };
    return fromRuns(want, w.runs, ` by ${w.label}`);
  }
  let rows = [];
  try { rows = sessionId ? require('../harness/memory').messages(sessionId) : []; } catch { rows = []; }
  if (!rows.length) return { state: 'unknown', why: `the hub keeps no record of \`${want}\` being run` };
  return fromRuns(want, hubRuns(rows, want), '', { root });
}

/**
 * Every check of a task where it worked, and its test: { ok, why, held, total, failed: [why], test }. What the engine
 * stores as a finished task's verdict, for every task — a try or not.
 */
async function verifyAll(t, { cwd, sessionId } = {}) {
  const pc = require('../harness/plan-contracts');
  const checks = checksOf(t);
  const results = [];
  for (const check of checks) {
    try { results.push(await pc.verify({ check }, { cwd })); } catch (e) { results.push({ ok: false, why: `could not be checked: ${e.message}` }); }
  }
  const failed = results.filter(r => !r.ok).map(r => r.why);
  const test = testEvidence(t, sessionId, cwd);
  const held = results.length - failed.length;
  const ok = !failed.length && test?.state !== 'failed';
  const said = !checks.length ? 'no check — on the agent\'s word' : failed.length ? failed[0] : results.length === 1 ? results[0].why : `all ${results.length} checks held`;
  const why = [said, test ? test.why : ''].filter(Boolean).join('; ');
  return { ok, why: ok ? why : (failed.length ? failed[0] : test.why), held, total: results.length, failed, ...(test ? { test } : {}) };
}

/** The verdict of a try with nowhere to be judged (its work never reached the hub): failed, saying why. */
function notJudged(t, why) {
  return { ok: false, why, held: 0, total: checksOf(t).length, failed: [why] };
}

/** One try's score, from its view, its verdict and its records. */
function score(t, v) {
  const m = t.missionId ? require('../agents/missions').get(t.missionId) : null;
  let failures = 0;
  try { for (const r of (m?.sessionId ? require('../harness/memory').messages(m.sessionId) : [])) if (r.role === 'tool' && /^Error\b/.test(String(r.content || ''))) failures++; } catch { /* no transcript */ }
  const worker = (() => { try { return require('../harness-teams/store').byMission?.(t.missionId) || null; } catch { return null; } })();
  const vd = t.verdict || null;
  const finished = !!vd;   // the board checks a try only once it finished
  const ms = m?.startedAt && m?.endedAt ? Date.parse(m.endedAt) - Date.parse(m.startedAt) : null;
  return { id: t.id, n: t.trial.n, state: v?.state || 'failed', finished, eligible: finished && !!vd?.ok,
    held: vd?.held ?? 0, total: vd?.total ?? 0, failed: vd?.failed || [], test: vd?.test?.state || null, testWhy: vd?.test?.why || null,
    failures, tokens: m?.tokens || 0, usd: typeof worker?.cost === 'number' ? worker.cost : null, ms, why: finished ? vd.why : (v?.why || 'it did not finish'),
    branch: t.place?.worktree?.branch || null, missionId: t.missionId || null };
}

const TEST_RANK = { passed: 0, null: 1, unknown: 1, failed: 2 };
/** Better first: eligible, then finished, then checks held, then the test, then fewer failures; cost and time only break a tie. */
function rank(a, b) {
  return (b.eligible - a.eligible) || (b.finished - a.finished) || (b.held - a.held) || (TEST_RANK[a.test] - TEST_RANK[b.test]) || (a.failures - b.failures)
    || (a.tokens - b.tokens) || ((a.usd ?? 0) - (b.usd ?? 0)) || ((a.ms ?? Infinity) - (b.ms ?? Infinity)) || (a.n - b.n);
}
const sameMerit = (a, b) => a.eligible === b.eligible && a.held === b.held && TEST_RANK[a.test] === TEST_RANK[b.test] && a.failures === b.failures;

const k = n => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
/**
 * "3 tries — #2 kept: all 5 checks held; #1 failed 'text over text at 17 s'; #3 did not finish: …". When no try held,
 * the best finished one is kept as the best so far, what failed is said, and trying again is offered — never done by itself.
 */
function report(j) {
  const s = [...(j.scores || [])].sort((a, b) => a.n - b.n);
  const kept = s.find(x => x.kept);
  const held = x => (x.total ? (x.held === x.total ? (x.total === 1 ? 'its check held' : `all ${x.total} checks held`) : `${x.held} of ${x.total} checks held`) : 'no checks')
    + (x.test === 'passed' ? ', its test passed' : x.test === 'unknown' ? `, its test not known (${x.testWhy})` : '');
  const failedOf = x => x.failed[0] || x.testWhy || x.why;
  const one = x => {
    if (x.kept && j.partial) return `#${x.n} kept as the best so far: ${held(x)} — it failed '${failedOf(x)}'`;
    if (x.kept) return `#${x.n} kept${j.picked ? ` (picked by ${j.picked.by})` : ''}: ${held(x)}`;
    if (!x.finished) return `#${x.n} did not finish: ${x.why}`;
    if (x.eligible) return `#${x.n} also held, set aside${x.tie ? ` — a tie, kept #${kept?.n} for ${x.tieWhy}` : ` (${held(x)})`}`;
    return `#${x.n} failed '${failedOf(x)}'`;
  };
  const head = `${s.length} tries — ${j.partial ? 'none held every check: ' : kept ? '' : 'none kept, no try held every check: '}`;
  const offer = j.partial || !kept ? ` — to try again, the team's leader asks the person and calls team keep_going${j.partial ? `; Keep this try on #${kept.n} goes on with it as it is` : ''}` : '';
  return `${head}${[kept, ...s.filter(x => x !== kept)].filter(Boolean).map(one).join('; ')}${offer}`;
}

/** Score a group's tries, keep the best eligible one, put the others' missions away, and write the report. */
async function judge(team, of, tasks, views, { reviewer = null } = {}) {
  const j = team.trials[of];
  const scores = tasks.map(t => score(t, views.find(v => v.id === t.id))).sort(rank);
  let best = scores[0]?.eligible ? scores[0] : null;
  const tied = best ? scores.filter(s => s.eligible && sameMerit(s, best)) : [];
  if (tied.length > 1) {
    let chosen = null;
    if (reviewer) try { chosen = await reviewer({ team, of, tied }); } catch { chosen = null; }
    const pickedBy = tied.find(s => s.id === chosen);
    if (pickedBy) { best = pickedBy; j.tieReviewed = true; }
    for (const s of tied) if (s !== best) Object.assign(s, { tie: true, tieWhy: pickedBy ? 'the review' : (s.tokens !== best.tokens ? `fewer tokens (${k(best.tokens)} vs ${k(s.tokens)})` : (s.usd ?? 0) !== (best.usd ?? 0) ? 'a lower cost' : 'less time') });
  }
  // None held every check: the best one that finished is kept as the best so far (its branch is the work to go on
  // from), the group reads as failed, and trying again is offered in the report — never started by itself.
  const partial = !best && scores[0]?.finished ? scores[0] : null;
  if (partial) best = partial;
  for (const s of scores) s.kept = s === best;
  Object.assign(j, { judgedAt: new Date().toISOString(), winner: best?.id || null, partial: !!partial, scores, tries: tasks.length });
  j.report = report(j);
  for (const s of scores) if (!s.kept && s.missionId) try { require('../agents/missions').archive(s.missionId); } catch { /* still running: left in the bar */ }
  require('./announce').line(team, `${of}: ${j.report}`);
  try { require('../activity').note({ from: 'teams', sessionId: team.by, what: `judged ${tasks.length} tries of task ${of} of team "${team.title}": ${j.report}`, why: 'every try had ended, or the wait after the first good one was over' }); } catch { /* no activity log */ }
  return j;
}

module.exports = { verifyAll, notJudged, testEvidence, isTestRun, fromRuns, checksOf, score, rank, report, judge };
