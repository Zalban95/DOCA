'use strict';

/**
 * A project's build (parametric projects, phase 1): its stages in order (params/stage.js), each a recipe run with no
 * model, as the person who asked — their level, approvals and the charter's tool rules, exactly as a recipe they run
 * by hand. Outputs are made in build/.next and copied onto the project only when every stage's checks hold, so a build
 * that fails leaves the last good deliverables where they were and says which check failed. A stage whose inputs are
 * unchanged since a build that held is not run again. One build per project: a second one stops the first and builds
 * the newest values. Its end is a stamp (params/stamp.js), an activity line and a `project` change on the live feed.
 */
const fs = require('fs');
const path = require('path');
const file = require('./file');
const stamp = require('./stamp');
const stage = require('./stage');

const _running = new Map();   // project id → { ctrl, promise, state }
const _last = new Map();      // project id → the last build's result, in memory (the stamp is the record)

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const changed = (id, what) => { try { require('../live').changed('project', id, what); } catch { /* a screen never breaks the work */ } };

/** Why this project cannot be built now, or null. */
function refusal(root) {
  const f = file.read(root);
  if (!f.exists) return `There is no ${file.NAME} in this project.`;
  if (f.errors.length) return `${file.NAME} has problems: ${f.errors.join(' ')}`;
  if (!Array.isArray(f.doc.build) || !f.doc.build.length) return `${file.NAME} declares no build.`;
  const p = f.doc.build.flatMap((st, i) => stage.problems(st, i));
  return p.length ? p.join(' ') : null;
}

async function runAll(p, { person, client, signal, state }) {
  const root = p.root, f = file.read(root), doc = f.doc, vals = file.effective(doc);
  const prev = stamp.read(root);
  const next = path.join(root, 'build', '.next');
  fs.rmSync(next, { recursive: true, force: true });
  fs.mkdirSync(next, { recursive: true });
  const fp = stamp.fingerprint(root, doc);
  const out = { format: 1, at: new Date().toISOString(), by: person?.id ? { id: person.id, name: person.name || person.email || person.id } : null,
    paramsHash: f.hash, build: { hash: fp.hash, steps: fp.build, scripts: fp.scripts }, values: vals, ok: true, stages: [] };
  let derived = {}, upstream = '';
  for (const [i, st] of doc.build.entries()) {
    state.stage = st.id; state.done = i; changed(p.id, 'build');
    const rec = await stage.run(st, { root, next, doc, vals, derived, upstream, prev: (prev?.stages || []).find(x => x.id === st.id),
      person, client, signal, projectId: p.id, emit: () => {} });
    out.stages.push(rec);
    upstream = file.sha(upstream + rec.inputs);
    try { derived = JSON.parse(fs.readFileSync(path.join(next, 'build', 'derived.json'), 'utf8')); } catch { /* none written */ }
    if (signal.aborted) { out.ok = false; out.failed = st.id; out.stopped = true; break; }
    if (!rec.ok) { out.ok = false; out.failed = st.id; break; }
  }
  out.derived = derived;
  if (out.ok) {
    // Every check held: the deliverables move onto the project, and the build folder goes.
    for (const rec of out.stages) for (const rel of Object.keys(rec.outputs || {})) {
      const to = path.join(root, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(next, rel), to);
    }
    fs.rmSync(next, { recursive: true, force: true });
  } else {
    out.lastGood = prev?.ok ? { at: prev.at, paramsHash: prev.paramsHash, values: prev.values } : prev?.lastGood || null;
    // A failed stage's own record cannot be skipped next time (its outputs never reached the project).
  }
  out.ms = out.stages.reduce((n, s) => n + (s.ms || 0), 0);
  stamp.write(root, out);
  stamp.accept(person, p.id, fp);
  return out;
}

/**
 * Start a build (it runs on after the answer). `acceptBuild`: the person saw what changed in the build since they last
 * ran it (`changedFor`); without it a changed build is refused with the diff, as a plan is shown before it runs.
 * `say: true` (a build asked in chat) runs it anyway and returns the change as one line instead.
 */
function start(p, { person = null, client = null, acceptBuild = false, say = false } = {}) {
  const why = refusal(p.root);
  if (why) throw bad(why);
  const fp = stamp.fingerprint(p.root, file.read(p.root).doc);
  const ch = stamp.changedFor(person, p.id, p.root, fp);
  if (ch.changed && !acceptBuild && !say)
    throw Object.assign(bad(`${stamp.changedLine(ch)} Look at it, then build again to accept it.`, 409), { code: 'build_changed', change: ch });
  const was = _running.get(p.id);
  if (was) was.ctrl.abort(new Error('a newer build replaced it'));
  const ctrl = new AbortController();
  const state = { state: 'running', startedAt: new Date().toISOString(), by: person?.id || null, stage: null, done: 0, of: file.read(p.root).doc.build.length };
  const promise = (async () => {
    if (was) await was.promise.catch(() => {});
    if (ctrl.signal.aborted) return null;
    try {
      const r = await runAll(p, { person, client, signal: ctrl.signal, state });
      _last.set(p.id, { state: r.stopped ? 'stopped' : r.ok ? 'done' : 'failed', at: r.at, ok: r.ok, failed: r.failed || null,
        why: r.failed ? r.stages.find(s => s.id === r.failed)?.why || null : null, ms: r.ms });
      try {
        require('../activity').note({ from: 'projects', what: r.ok ? `built ${p.name}` : `the build of ${p.name} ${r.stopped ? 'was replaced by a newer one' : `failed at ${r.failed}`}`,
          why: r.ok ? `${r.stages.filter(s => !s.skipped).length} of ${r.stages.length} stage(s) ran` : (_last.get(p.id).why || ''), person, level: r.ok || r.stopped ? 'info' : 'warn' });
      } catch { /* the line is a nicety */ }
      return r;
    } catch (e) {
      _last.set(p.id, { state: 'failed', at: new Date().toISOString(), ok: false, why: e.message });
      return null;
    } finally {
      if (_running.get(p.id)?.ctrl === ctrl) _running.delete(p.id);
      changed(p.id, 'build');
    }
  })();
  _running.set(p.id, { ctrl, promise, state });
  changed(p.id, 'build');
  return { ...state, ...(say && ch.changed ? { note: stamp.changedLine(ch) } : {}), promise };
}

/** Where the build is: running (stage, how many of how many), else the last one's outcome, with the stamp's proof. */
function status(p) {
  const run = _running.get(p.id);
  const built = stamp.builtNow(p.root);
  const s = stamp.read(p.root);
  return {
    running: run ? { ...run.state } : null,
    last: _last.get(p.id) || (s ? { state: s.ok ? 'done' : 'failed', at: s.at, ok: s.ok, failed: s.failed || null } : null),
    built, stages: (s?.stages || []).map(x => ({ id: x.id, ok: x.ok, skipped: !!x.skipped, ms: x.ms || 0, why: x.why || null,
      outputs: Object.keys(x.outputs || {}), checks: (x.checks || []).map(c => ({ ok: c.ok, why: c.why })) })),
    derived: s?.derived || {},
  };
}

/** Wait for the build running now (tests, and a tool asked to wait). */
function wait(p) { return _running.get(p.id)?.promise || Promise.resolve(null); }

module.exports = { refusal, start, status, wait };
