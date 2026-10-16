'use strict';

/**
 * One outside worker from start to end (harness-teams/): its computer, the CLI, the project, the run, its branch back.
 * Every step is a plan item on its mission, so the missions bar, devices, the team's board and Chronicle draw it like
 * any member; what the CLI does is said mechanically (its own commands, tools and words, from its own event stream:
 * events.js) on the mission's log and the Workstream. Its notes for teammates (a line appended to a file) become team
 * notes as its own words, and its teammates' notes are written into its box for it to read. No model is asked anything
 * by the hub here.
 */
const box = require('./box');
const events = require('./events');
const harnesses = require('./harnesses');
const trajectory = require('./trajectory');
const S = require('./store');

const POLL_MS = () => Number(process.env.DOCA_TEAM_POLL_MS) || 20000;   // how often a running worker's branch and notes are looked at
const PLAN = ['A computer', 'The harness in it', 'The project on its branch', 'At work', 'Its branch back on the hub'];
const live = new Map();   // worker id → { c, pidfile, child }
let _lock = Promise.resolve();   // computers are picked one worker at a time, so two never take the same one

const missions = () => require('../agents/missions');
const index = () => require('./index');
const tick = (w, title, state) => { try { missions().setPlan(w.missionId, { tick: { title, state } }); } catch { /* bookkeeping */ } };

/** The kept computer for this harness that no running worker uses, made the first time (its sign-in stays in it). */
function computerFor(w, row) {
  const pick = async () => {
    const computers = require('../computers');
    const type = `harness:${row.id}`;
    const busy = new Set(S.running().filter(x => x.computer && x.id !== w.id).map(x => x.computer));
    let c = computers.rows().find(x => x.agentType === type && !busy.has(x.id));
    if (!c) {
      const n = computers.rows().filter(x => x.agentType === type).length + 1;
      const v = await computers.create({ name: `${row.label} worker ${n}`.slice(0, 40), agentType: type,
        purpose: `Kept for ${row.label} in harness teams: it is installed here once, and a sign-in made here stays for the next team.` });
      c = computers.get(v.id);
    } else {
      if (c.archivedAt) computers.patch(c.id, { archivedAt: null });
      const st = (await computers.list({ all: true })).find(x => x.id === c.id)?.state;
      if (st !== 'running') await computers.start(c.id);
    }
    S.patch(w.id, { computer: c.id });
    computers.patch(c.id, { missionId: w.missionId, missions: [...(c.missions || []), w.missionId].slice(-20), stoppedAt: null });
    return computers.get(c.id);
  };
  const p = _lock.then(pick, pick);
  _lock = p.catch(() => {});
  return p;
}

/** What the CLI did, said where the work is watched: the mission's log, the Workstream, the step count. */
function say(w, ev, scrub) {
  const name = `${w.harness}__${ev.type === 'command' ? 'shell' : String(ev.tool || 'tool').replace(/[^\w-]/g, '_')}`;
  const ws = require('../workstream');
  if (ev.type === 'command' || ev.type === 'tool') {
    const args = ev.type === 'command' ? { command: scrub(ev.text) } : { ...(ev.path ? { path: ev.path } : {}) };
    missions().record(w.missionId, { type: 'tool_call', name, args });
    ws.onEvent({ sessionId: w.sessionId, type: 'tool_call', name, args });
    const n = (S.get(w.id)?.steps || 0) + 1;
    S.patch(w.id, { steps: n });
    const m = missions().patch(w.missionId, { steps: n });
    if (!w._said || Date.now() - w._said > 2000) { w._said = Date.now(); missions().announce(m, { ephemeral: true }); }
  } else if (ev.type === 'result') {
    missions().record(w.missionId, { type: 'tool_result', name, result: scrub(ev.text), ok: ev.ok });
    ws.onEvent({ sessionId: w.sessionId, type: 'tool_result', name, result: `${ev.ok === false ? 'Error: ' : ''}${scrub(ev.text)}` });
  } else if (ev.type === 'text') ws.onEvent({ sessionId: w.sessionId, type: 'text', text: scrub(ev.text) });
}

/** Commits came back: said once per pull, in the Workstream and the activity log, with what changed. */
async function pulled(w, r, project) {
  const git = require('../projects/git').git;
  const quiet = p => p.then(x => x.trim(), () => '');
  const stat = await quiet(git(project.root, ['diff', '--shortstat', `${w.base}...${w.branch}`]));
  const subject = await quiet(git(project.root, ['log', '-1', '--format=%h %s', w.branch]));
  S.patch(w.id, { head: r.head, commits: r.commits, stat });
  const text = `${w.branch}: ${r.commits} commit${r.commits === 1 ? '' : 's'} on the hub — latest ${subject}${stat ? ` (${stat})` : ''}`;
  require('../workstream').outside(`${w.label} in ${project.name}`, text, { sessionId: w.sessionId });
  require('../activity').note({ from: 'harness-teams', what: text, why: `${w.label} committed in its computer`, sessionId: w.sessionId });
  require('../live').changed('projects', project.id, 'branches');
}

/** Notes both ways: its new lines become team notes (its own words); its teammates' notes are written into its box. */
async function notes(w, c) {
  const team = require('../teams/store').get(w.teamId);
  if (!team) return;
  const lines = (await box.read(c, w.notesOut)).split('\n').map(l => l.trim()).filter(Boolean);
  const seen = S.get(w.id)?.notesSeen || 0;
  for (const l of lines.slice(seen)) { try { require('../teams').note(w.missionId, l); } catch { /* the team's own limits */ } }
  if (lines.length > seen) S.patch(w.id, { notesSeen: lines.length });
  const theirs = (team.notes || []).filter(n => n.missionId !== w.missionId).map(n => `- ${n.task} (${n.from}): ${n.text}`);
  const text = `# Your teammates' findings\n${theirs.join('\n') || '(none yet)'}\n`;
  if (text !== w._notesIn) { w._notesIn = text; await box.write(c, w.notesIn, text); }
}

async function run(w) {
  const row = harnesses.all().find(r => r.id === w.harness);
  const project = require('../projects/store').get(w.projectId);
  let key = null, relay = {};
  const scrub = t => [key?.value, relay.OPENAI_API_KEY].filter(Boolean).reduce((s, v) => s.split(v).join('[key]'), String(t ?? ''));
  const stopped = () => S.get(w.id)?.stopRequested;
  try {
    if (!row || !project) throw new Error(!row ? `${w.harness} is no longer in the catalogue` : 'its project is gone');
    tick(w, PLAN[0], 'running');
    const c = await computerFor(w, row);
    tick(w, PLAN[0], 'done'); tick(w, PLAN[1], 'running');
    if (stopped()) return index().finish(w.id, { state: 'cancelled', error: 'stopped before it began' });
    const { bin, installed } = await box.install(c, row);
    if (installed) require('../activity').note({ from: 'harness-teams', what: `installed ${row.label} in ${c.name}`, why: 'its first team worker', machine: { kind: 'computer', id: c.id, name: c.name } });
    key = harnesses.keyFor(row);
    const by = require('../teams/store').get(w.teamId)?.outsideBy;
    relay = await trajectory.relayEnv(c, row, `${row.label} on task ${w.task} works on this hub's model — ${by === 'free' ? 'its switch is "On its own"' : 'the person said yes to running it'}`);   // DOCA's own model through the relay (team.relay), or {}
    if (!key && !row.team.relay && (await box.signedIn(c, row, bin)) === false) return index().needsSignIn(w.id, c, row);
    tick(w, PLAN[1], 'done'); tick(w, PLAN[2], 'running');
    const { dir, base } = await box.putProject(c, { root: project.root, worker: w.id, branch: w.branch, from: w.from, author: `${row.label} (DOCA team)` });
    S.patch(w.id, { dir, base, state: 'running' }); Object.assign(w, { dir, base });
    await notes(w, c).catch(() => {});
    tick(w, PLAN[2], 'done'); tick(w, PLAN[3], 'running');
    if (stopped()) return index().finish(w.id, { state: 'cancelled', error: 'stopped before it began' });

    const pidfile = `${box.HOME}/teams/.${w.id}.pid`;
    S.patch(w.id, { pidfile });
    const traj = row.team.output ? `${box.HOME}/teams/${w.id}.traj.json` : null;   // outside its folder, which goes when it ends
    const env = { ...(row.team.env || {}), ...(key ? { [key.env]: key.value } : {}), ...relay };
    const child = box.run(c, { dir, bin, args: harnesses.argv(row, { task: index().preamble(w), model: w.model, output: traj }), env, pidfile });
    live.set(w.id, { c, pidfile, child });
    let buf = '', err = '', final = null, seen = 0, trajText = '';
    const readTraj = async () => {   // a CLI that writes a trajectory, not a stream: its new messages, said the same way
      if (!traj) return;
      trajText = await box.read(c, traj);
      const r = trajectory.read(trajText, seen);
      seen = r.seen; r.events.forEach(ev => say(w, ev, scrub));
      if (r.final) final = r.final;
    };
    const take = l => { for (const ev of events.parse(row.team.events, l)) { if (ev.type === 'final') final = ev; else if (ev.type === 'error') err = `${err}\n${ev.text}`.slice(-2000); else say(w, ev, scrub); } };
    child.stdout.on('data', d => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(take); });
    child.stderr.on('data', d => { err = (err + d.toString()).slice(-2000); });
    let busy = false;
    const look = async () => {
      if (busy) return; busy = true;
      try {
        const r = await box.pull(c, { dir, branch: w.branch, base, root: project.root, worker: w.id });
        if (r && r.head !== S.get(w.id)?.head) await pulled(w, r, project);
        await notes(w, c);
        await readTraj();
      } catch { /* the end tries again */ } finally { busy = false; }
    };
    const poll = setInterval(look, POLL_MS());
    poll.unref?.();
    const code = await new Promise(resolve => { child.on('close', resolve); child.on('error', () => resolve(1)); });
    clearInterval(poll);
    while (busy) await new Promise(r => setTimeout(r, 100));
    live.delete(w.id);
    take(buf);
    await readTraj().catch(() => {});
    const ran = traj ? trajectory.runs(trajText) : null;   // its commands' exit codes, read for a test's verdict (teams/tries-score.js)
    if (ran) S.patch(w.id, { runs: ran.map(r => ({ ...r, command: scrub(r.command) })) });
    let kept = null;
    // Its trajectory, as an attachment — scrubbed first like its live events, and of every secret DOCA keeps (trajectory.scrub).
    if (traj) kept = await box.read(c, traj).then(text => trajectory.keep(text, { given: [key?.value, relay.OPENAI_API_KEY], name: `${w.id}.traj.json`, from: `mcp:computer-${c.id}` }), () => null).catch(() => null);
    if (kept && final) final = { ...final, text: `${final.text}\n\nIts trajectory (every step, as it ran) is kept as the attachment ${kept}.` };

    tick(w, PLAN[3], code === 0 ? 'done' : 'failed'); tick(w, PLAN[4], 'running');
    await notes(w, c).catch(() => {});
    await box.commitLeftovers(c, dir, row.label).catch(() => false);
    const r = await box.pull(c, { dir, branch: w.branch, base, root: project.root, worker: w.id }).catch(e => ({ error: e.message }));
    if (r?.error) err = `${err}\nIts branch did not come back to the hub: ${r.error}`;
    else if (r && r.head !== S.get(w.id)?.head) await pulled(w, r, project);
    tick(w, PLAN[4], r?.error ? 'failed' : 'done');
    if (!r?.error) await box.exec(c, ['rm', '-rf', dir]);   // its work is on the hub now; the computer keeps the harness and its sign-in
    const wasStopped = stopped();
    const ok = !wasStopped && code === 0 && final?.ok !== false && !r?.error;
    await index().finish(w.id, {
      state: wasStopped ? 'cancelled' : ok ? 'done' : 'failed', final: final ? scrub(final.text) : '', cost: final?.cost ?? null,
      error: ok ? null : wasStopped ? 'stopped by a person' : scrub(`${row.label} exited ${code}.${err.trim() ? ` ${err.trim().split('\n').slice(-3).join(' ')}` : ''}`).slice(0, 600),
    });
  } catch (e) {
    live.delete(w.id);
    await index().finish(w.id, { state: 'failed', error: scrub(String(e?.message || e)).slice(0, 600) });
  }
}

/** Stop a worker: its CLI and everything it started end; what it committed still comes back (run's own end does that). */
async function stop(w) {
  S.patch(w.id, { stopRequested: true });
  const l = live.get(w.id);
  if (l) await box.kill(l.c, l.pidfile);
  return !!l;
}

/** After a restart: end the CLI the hub no longer follows and bring back what it committed. */
async function salvage(w) {
  const c = w.computer ? require('../computers').get(w.computer) : null;
  const project = require('../projects/store').get(w.projectId);
  if (!c || !w.dir || !project) return;
  if (w.pidfile) await box.kill(c, w.pidfile).catch(() => {});
  await box.commitLeftovers(c, w.dir, w.label).catch(() => {});
  const r = await box.pull(c, { dir: w.dir, branch: w.branch, base: w.base, root: project.root, worker: w.id }).catch(() => null);
  if (r) await pulled(w, r, project);
}

module.exports = { run, stop, salvage, live, PLAN };
