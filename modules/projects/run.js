'use strict';

/**
 * Run one of a project's commands by name ("build", "test", "install"…): the
 * Projects tab's buttons and the agent's `project run` are the same call.
 *
 * It runs as a background job (harness/jobs.js) in the project root — a build
 * can take minutes — and waits for it up to `waitSec`; a command that finishes
 * in time comes back with its exit code and output, one that does not comes
 * back as a job id to follow. A command whose toolchain is missing is refused
 * before it starts, with what to install.
 */
const jobs = require('../harness/jobs');
const projects = require('./store');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** The project's commands: detected ones, with the owner's own over them. */
async function commands(p) {
  const info = await require('./inspect').inspect(p.root);
  const own = Object.entries(p.commands || {}).filter(([, v]) => v).map(([name, run]) => ({ name, run, needs: [], missing: [], what: 'added for this project', kind: 'own' }));
  const byName = new Map(info.commands.map(c => [c.name, c]));
  for (const c of own) byName.set(c.name, c);
  return { info, commands: [...byName.values()] };
}

async function run(projectId, name, { waitSec = 0, sessionId = null } = {}) {
  const p = projects.need(projectId);
  const { commands: list } = await commands(p);
  const c = list.find(x => x.name === name);
  if (!c) throw bad(`"${name}" is not a command of ${p.name}. It has: ${list.map(x => x.name).join(', ') || 'none detected'}.`, 404);
  if (c.missing.length) throw bad(`${c.run} needs ${c.missing.join(', ')}, which ${c.missing.length === 1 ? 'is' : 'are'} not installed on this machine.`, 424);
  const job = jobs.start(c.run, { cwd: p.root, sessionId });
  const until = Date.now() + Math.max(0, Number(waitSec) || 0) * 1000;
  let j = jobs.get(job.id);
  while (j.state === 'running' && Date.now() < until) {
    await new Promise(r => setTimeout(r, 250));
    j = jobs.get(job.id);
  }
  return { command: c, job: j, output: j.state === 'running' ? null : jobs.output(job.id, 16000) };
}

module.exports = { commands, run };
