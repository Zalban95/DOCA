'use strict';

/**
 * Settings → Evaluations (TODO H10.1): the sets, their results, a run, import and export. A run is bin/doca-eval.js in
 * a child process — the same code as `npm run eval`, on a throwaway copy of the settings — so the live hive's
 * conversations and memory are never part of an evaluation; its JSON lines are kept here for the panel to poll.
 * One run at a time. All host: a run spends the model's tokens and its results hold the answers.
 */
const path = require('path');
const store = require('./store');

const h = fn => async (req, res) => { try { const out = await fn(req, res); if (!res.headersSent) res.json(out); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
let current = null;   // { set, startedAt, lines: [], done, code, child }

function start(id) {
  if (current && !current.done) throw bad(`An evaluation is already running (${current.set}).`, 409);
  if (!store.get(id)) throw bad('No such set.', 404);
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'doca-eval.js'), id, '--json'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { set: id, startedAt: new Date().toISOString(), lines: [], done: false, code: null, child, stderr: '' };
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { run.lines.push(JSON.parse(line)); } catch { /* not ours */ } }
  });
  child.stderr.on('data', d => { run.stderr = (run.stderr + d).slice(-2000); });
  child.on('close', code => { run.done = true; run.code = code; run.child = null; });
  current = run;
  return view(run);
}

const view = r => r && ({ set: r.set, startedAt: r.startedAt, done: r.done, code: r.code, progress: r.lines.filter(l => l.case),
  result: r.lines.find(l => l.result)?.result || null, error: r.lines.find(l => l.error)?.error || (r.done && r.code && !r.lines.some(l => l.result) ? r.stderr.trim() || `exit ${r.code}` : null) });

function mount(app) {
  app.get('/api/evals', h(() => ({ running: view(current), sets: store.list().map(s => {
    const last = store.results(s.id, 1)[0];
    return { id: s.id, title: s.title, description: s.description, origin: s.origin, cases: s.cases?.length || 0,
      last: last && { passed: last.passed, total: last.total, startedAt: last.startedAt, model: last.model, regressed: last.regressed, tokens: last.tokens } };
  }) })));
  app.post('/api/evals/import', h(req => {
    const b = req.body || {};
    if (b.format === 'openai-evals') {
      const { set, skipped } = require('./io').fromOpenAiEvals(b.text, { id: b.id, title: b.title });
      return { set: store.save(set), skipped };
    }
    let set; try { set = typeof b.text === 'string' ? JSON.parse(b.text) : b.set; } catch (e) { throw bad(`Not JSON: ${e.message}`); }
    return { set: store.save(set), skipped: 0 };
  }));
  app.get('/api/evals/:id', h(req => {
    const set = store.get(req.params.id);
    if (!set) throw bad('No such set.', 404);
    return { set, results: store.results(set.id, 10), running: current?.set === set.id ? view(current) : null };
  }));
  app.put('/api/evals/:id', h(req => {
    if ((req.body || {}).id !== req.params.id) throw bad('The set\'s id must be the one in the address.');
    return { set: store.save(req.body) };
  }));
  app.delete('/api/evals/:id', h(req => { store.remove(req.params.id); return { deleted: req.params.id }; }));
  app.post('/api/evals/:id/run', h(req => start(req.params.id)));
  app.get('/api/evals/:id/export', h((req, res) => {
    const set = store.get(req.params.id);
    if (!set) throw bad('No such set.', 404);
    const { origin, ...clean } = set;
    if (req.query.format === 'promptfoo') {
      res.setHeader('Content-Disposition', `attachment; filename="${set.id}.promptfooconfig.yaml"`);
      res.type('text/yaml').send(require('./io').promptfoo(clean));
      return undefined;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${set.id}.eval.json"`);
    return clean;
  }));
}

module.exports = { mount };
