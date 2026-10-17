'use strict';

/**
 * A team task's contract made sound before the team starts (team create and add): what "done" is checked by.
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/**
 * A task that writes code in a project with a test command, given no test by its leader, gets the project's own
 * (2026-10-17: the make-a-browser-game skill said "test on every code task"; a cheaper leader may leave it out, and
 * then nothing but the member's word says the work runs). Returns {test, tasks} or null; the team tool says so.
 */
async function defaultTests(tasks, project, root) {
  if (!project) return null;
  let test = null;
  try { test = (await require('../projects/run').commands({ ...project, root: root || project.root })).commands.find(c => c.name === 'test')?.run || null; } catch { /* no commands known */ }
  if (!test) return null;
  const place = require('./place'), outside = require('./outside');
  const ids = [];
  for (const t of tasks) if (!t.test && t.agent !== 'work' && !outside.isOutside(t.agent) && place.writes(t.agent)) { t.test = test; ids.push(t.id); }
  return ids.length ? { test, tasks: ids } : null;
}

/**
 * A contract that already holds before any work proves nothing (2026-10-17: a game's four tasks were "done" on checks
 * like {file: "src/story.js", contains: "ending"} that the leader's own scaffold already met). A task with no test and
 * no tries whose checks are all files, every one there already, is refused with how to give it a real one.
 */
async function provesNothing(tasks, cwd) {
  if (!cwd) return;
  const pc = require('../harness/plan-contracts');
  for (const t of tasks) {
    const checks = [t.contract?.check, ...(t.checks || [])].filter(Boolean);
    if (t.test || t.trial || !checks.length || !checks.every(c => c.file && !require('../checks').kind(c))) continue;
    const held = await Promise.all(checks.map(c => pc.verify({ check: c }, { cwd }).catch(() => ({ ok: false }))));
    if (held.every(r => r.ok)) throw bad(`Task ${t.id}: its check already holds before any work (${held.map(r => r.why).join('; ')}), so it proves nothing. `
      + 'Give it one that fails until the work is done — a test (test: "npm test", with a test that fails now), a file or words that do not exist yet, '
      + 'a page that shows what the task makes ({page, selector}) — or leave the check out and say "done when" in words.');
  }
}

module.exports = { defaultTests, provesNothing };
