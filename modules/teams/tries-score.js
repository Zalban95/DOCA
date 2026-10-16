'use strict';

/**
 * Scoring tries mechanically (tries.js; improvement D2): what a person would look at, read from records and files —
 * never from a model's opinion.
 *
 *   checks    every check of the task (its contract's and `checks`), run where the try worked; held of total, and the
 *             first that failed in its own words ("text over text at 17 s")
 *   test      the task's test command (`test`), as the try last ran it itself — its `shell` call in its own conversation,
 *             under its own approvals, or for an outside harness the command its trajectory records with its return code
 *             (harness-teams/trajectory.js `runs`) — and only a call that is exactly the test, output redirections aside
 *             (`isTestRun`): passed, failed, or not known (never run that way, or run before a later change). The hub never
 *             runs it: a check never runs a command (plan-contracts.js), so a test cannot become a way around the approvals.
 *   failures  the try's failed calls (results that begin "Error")
 *   cost      tokens spent, then time — tie-breakers only
 *
 * A try is eligible when it finished, every check held and its test did not fail; the best eligible try is kept.
 */
const WRITES = new Set(['write_file', 'replace_in_files', 'edit_file']);

const argsOf = c => { try { return JSON.parse(c?.function?.arguments || '{}'); } catch { return {}; } };

/** The task's checks: its contract's, then `checks`. */
const checksOf = t => [t.contract?.check, ...(Array.isArray(t.checks) ? t.checks : [])].filter(Boolean);

const norm = c => String(c ?? '').trim().replace(/\s+/g, ' ');
/** Only output redirections may follow the test: `> f`, `>> f`, `2>&1`, `&> f`, `2>/dev/null`. */
const REDIRECTS = /^(?:\s*(?:\d?>>?|&>>?)\s*(?:&\d|[^\s|;&<>()`$]+))*\s*$/;

/**
 * Whether a command line is a run of the test: exactly the test (trimmed, whitespace made single), or the test followed
 * only by output redirections. Anything else — piped (`npm test | tail`, whose exit is tail's), chained (`npm test ||
 * true`), echoed — is not a run, so its exit code says nothing about the test.
 */
function isTestRun(command, test) {
  const want = norm(test), cmd = norm(command);
  if (!want || !cmd.startsWith(want)) return false;
  const rest = cmd.slice(want.length);
  return rest === '' || (/^\s|^[&\d]?>/.test(rest) && REDIRECTS.test(rest));
}

/**
 * The test's verdict from a try's commands in order — `[{command, code, changes}]`: `code` the exit code (null: did not
 * finish), `changes` a step that may have changed the work after it. The last run of the test decides, unless a change
 * came after it.
 */
function fromRuns(test, runs, where) {
  const want = norm(test);
  let last = -1;
  runs.forEach((r, i) => { if (isTestRun(r.command, want)) last = i; });
  if (last < 0) return { state: 'unknown', why: `\`${want}\` was never run${where}` };
  if (runs.slice(last + 1).some(r => r.changes && !isTestRun(r.command, want))) return { state: 'unknown', why: `\`${want}\` was last run before a later change` };
  const code = runs[last].code;
  if (code === 0) return { state: 'passed', why: `\`${want}\` passed` };
  return { state: 'failed', why: code == null ? `\`${want}\` did not finish` : `\`${want}\` exited ${code}` };
}

/** A try on the hub: its own conversation's shell calls (a write is a change), as `fromRuns` reads them. */
function hubRuns(rows) {
  const calls = new Map(), runs = [];
  for (const r of rows) {
    if (r.role === 'assistant') for (const c of r.tool_calls || []) {
      const name = c.function?.name, a = argsOf(c);
      calls.set(c.id || name, { name, a });
      if (WRITES.has(name)) runs.push({ command: '', code: null, changes: true });
    }
    if (r.role === 'tool') {
      const c = calls.get(r.tool_call_id) || { name: r.name, a: {} };
      if (c.name === 'shell' && !c.a.background) {
        const out = String(r.content || ''), m = /^exit (-?\d+)/.exec(out);
        if (m || /^(Timed out|Not finished)/.test(out)) runs.push({ command: String(c.a.command || ''), code: m ? Number(m[1]) : null, changes: false });   // a refused call is no run
      }
    }
  }
  return runs;
}

/** What the try's own record says of its test: { state: passed|failed|unknown, why }. */
function testEvidence(t, sessionId) {
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
  return fromRuns(want, hubRuns(rows), '');
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
  const test = testEvidence(t, sessionId);
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
/** Better first: eligible, then checks held, then the test, then fewer failures; cost and time only break a tie. */
function rank(a, b) {
  return (b.eligible - a.eligible) || (b.held - a.held) || (TEST_RANK[a.test] - TEST_RANK[b.test]) || (a.failures - b.failures)
    || (a.tokens - b.tokens) || ((a.usd ?? 0) - (b.usd ?? 0)) || ((a.ms ?? Infinity) - (b.ms ?? Infinity)) || (a.n - b.n);
}
const sameMerit = (a, b) => a.eligible === b.eligible && a.held === b.held && TEST_RANK[a.test] === TEST_RANK[b.test] && a.failures === b.failures;

const k = n => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
/** "3 tries — #2 kept: all 5 checks held; #1 failed 'text over text at 17 s'; #3 did not finish: …" */
function report(j) {
  const s = [...(j.scores || [])].sort((a, b) => a.n - b.n);
  const kept = s.find(x => x.kept);
  const held = x => (x.total ? (x.held === x.total ? (x.total === 1 ? 'its check held' : `all ${x.total} checks held`) : `${x.held} of ${x.total} checks held`) : 'no checks')
    + (x.test === 'passed' ? ', its test passed' : x.test === 'unknown' ? `, its test not known (${x.testWhy})` : '');
  const one = x => {
    if (x.kept) return `#${x.n} kept${j.picked ? ` (picked by ${j.picked.by})` : ''}: ${held(x)}`;
    if (!x.finished) return `#${x.n} did not finish: ${x.why}`;
    if (x.eligible) return `#${x.n} also held, set aside${x.tie ? ` — a tie, kept #${kept?.n} for ${x.tieWhy}` : ` (${held(x)})`}`;
    return `#${x.n} failed '${x.failed[0] || x.testWhy || x.why}'`;
  };
  const head = `${s.length} tries — ${kept ? '' : 'none kept, no try held every check: '}`;
  return `${head}${[kept, ...s.filter(x => x !== kept)].filter(Boolean).map(one).join('; ')}`;
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
  for (const s of scores) s.kept = s === best;
  Object.assign(j, { judgedAt: new Date().toISOString(), winner: best?.id || null, scores, tries: tasks.length });
  j.report = report(j);
  for (const s of scores) if (!s.kept && s.missionId) try { require('../agents/missions').archive(s.missionId); } catch { /* still running: left in the bar */ }
  require('./announce').line(team, `${of}: ${j.report}`);
  try { require('../activity').note({ from: 'teams', sessionId: team.by, what: `judged ${tasks.length} tries of task ${of} of team "${team.title}": ${j.report}`, why: 'every try had ended, or the wait after the first good one was over' }); } catch { /* no activity log */ }
  return j;
}

module.exports = { verifyAll, notJudged, testEvidence, isTestRun, fromRuns, checksOf, score, rank, report, judge };
