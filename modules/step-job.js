'use strict';

/**
 * One job at a time per owner (the wake-word trainer's setup or training, the System 1 service's setup): its steps are
 * argv commands run in order, their output kept (the last 400 lines), the `@stage` lines a script prints shown as where
 * it is, the `@result {…}` line handed to the step's `done`. It outlives the page that started it — a training takes
 * about an hour — and the panel polls while it runs. Stop kills the step running and ends the job. `make()` gives each
 * owner its own slot, so a setup here never waits on a training there.
 */
const { spawn } = require('child_process');

function make() {
  let _job = null;

  function view() {
    if (!_job) return null;
    const { child, steps, ...rest } = _job;
    return { ...rest, log: rest.log.slice(-60) };
  }

  /** Start a job: `steps` is [{label, cmd, args, cwd, env, done(result)}]. Refused while another runs. */
  function start(kind, steps) {
    if (_job?.state === 'running') throw Object.assign(new Error(`A ${_job.kind} is running; one at a time.`), { status: 409 });
    _job = { kind, state: 'running', stage: steps[0]?.label || '', startedAt: new Date().toISOString(), endedAt: null, log: [], result: null, error: null, steps, child: null };
    run(_job).catch(() => { /* recorded on the job */ });
    return view();
  }

  async function run(job) {
    try {
      for (const step of job.steps) {
        if (job.state !== 'running') return;
        job.stage = step.label;
        const result = await exec(job, step);
        if (step.done) job.result = (await step.done(result)) ?? job.result;
      }
      job.state = 'done';
    } catch (e) {
      if (job.state === 'running') { job.state = 'failed'; job.error = e.message; }
    } finally { job.endedAt = new Date().toISOString(); job.child = null; }
  }

  function exec(job, { cmd, args, cwd, env, label }) {
    return new Promise((resolve, reject) => {
      say(job, `$ ${[cmd, ...args].join(' ')}`);
      let result = null, buf = '';
      const child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}), PYTHONUNBUFFERED: '1' }, windowsHide: true });
      job.child = child;
      const take = d => {
        buf += d.toString();
        let i;
        while ((i = buf.search(/[\r\n]/)) >= 0) {
          const line = buf.slice(0, i).trimEnd(); buf = buf.slice(i + 1);
          if (!line) continue;
          if (line.startsWith('@stage ')) job.stage = `${label}: ${line.slice(7)}`;
          else if (line.startsWith('@result ')) { try { result = JSON.parse(line.slice(8)); } catch { /* not ours */ } }
          say(job, line);
        }
      };
      child.stdout.on('data', take); child.stderr.on('data', take);
      child.on('error', e => reject(new Error(`${cmd}: ${e.message}`)));
      child.on('close', code => (code === 0 ? resolve(result) : reject(new Error(`${label} stopped (exit ${code}) — the log says why.`))));
    });
  }

  function say(job, line) { job.log.push(line.slice(0, 400)); if (job.log.length > 400) job.log.splice(0, job.log.length - 400); }

  function stop() {
    if (_job?.state !== 'running') return view();
    _job.state = 'stopped'; _job.error = 'Stopped by a person.';
    try { _job.child?.kill(); } catch { /* gone */ }
    return view();
  }

  return { start, view, stop };
}

module.exports = { make };
