'use strict';

/**
 * /api/projects — the Projects tab. Every route is the host right (a project
 * is files and a shell), and every one calls the same module the agent's tools
 * call. Files themselves are read and written through /api/files, as the Files
 * tab does: one implementation of "open a file", with its root checks.
 */
const projects = require('./store');
const git      = require('./git');

const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
const h = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { fail(res, e); } };
const P = req => projects.need(req.params.id);

async function detail(p) {
  const { info, commands } = await require('./run').commands(p);
  let status = null;
  try { if (await git.top(p.root)) status = await git.status(p.root); } catch {}
  return { project: p, kinds: info.kinds, commands, toolchains: info.toolchains, git: status };
}

function mount(app) {
  app.get('/api/projects', h(() => ({ projects: projects.list() })));
  app.post('/api/projects', h(req => ({ project: projects.create(req.body || {}) })));
  app.get('/api/projects/:id', h(async req => {
    const p = projects.update(req.params.id, { openedAt: new Date().toISOString() });
    return detail(p);
  }));
  app.post('/api/projects/:id', h(req => { require('./brief').forget(req.params.id); return { project: projects.update(req.params.id, req.body || {}) }; }));
  app.delete('/api/projects/:id', h(req => { projects.remove(req.params.id); return { ok: true }; }));

  app.post('/api/projects/:id/search', h(req => require('./search').search(P(req).root, req.body || {})));
  app.post('/api/projects/:id/replace', h(req => require('./search').replaceInFiles(P(req).root, { ...(req.body || {}), dryRun: !req.body?.apply })));

  app.get('/api/projects/:id/git/status', h(req => git.status(P(req).root)));
  app.get('/api/projects/:id/git/log', h(async req => ({ commits: await git.log(P(req).root, { file: req.query.file, limit: req.query.limit, rev: req.query.rev }) })));
  app.get('/api/projects/:id/git/branches', h(async req => ({ branches: await git.branches(P(req).root) })));
  app.get('/api/projects/:id/git/diff', h(async req => ({ diff: await git.diff(P(req).root, { file: req.query.file, rev: req.query.rev, staged: req.query.staged === '1', commit: req.query.commit }) })));
  app.get('/api/projects/:id/git/show', h(async req => {
    try { return { text: await git.show(P(req).root, String(req.query.file || ''), req.query.rev || 'HEAD'), exists: true }; }
    catch { return { text: '', exists: false }; }   // a new file has no earlier version: compare against empty
  }));
  app.post('/api/projects/:id/git/stage', h(req => git.stage(P(req).root, [].concat(req.body?.files || []))));
  app.post('/api/projects/:id/git/unstage', h(req => git.unstage(P(req).root, [].concat(req.body?.files || []))));
  app.post('/api/projects/:id/git/commit', h(async req => ({ commit: await git.commit(P(req).root, req.body?.message, { files: req.body?.files }) })));
  app.post('/api/projects/:id/git/switch', h(req => git.checkout(P(req).root, req.body?.branch, { create: !!req.body?.create })));

  app.post('/api/projects/:id/run', h(async req => {
    const r = await require('./run').run(req.params.id, String(req.body?.command || ''), { waitSec: 0 });
    return { command: r.command, job: r.job };
  }));
  app.get('/api/projects/:id/jobs/:job', h(req => {
    const jobs = require('../harness/jobs');
    P(req);
    return { job: jobs.get(req.params.job), output: jobs.output(req.params.job, Number(req.query.bytes) || 64000) };
  }));
  app.post('/api/projects/:id/jobs/:job/stop', h(req => { P(req); return { job: require('../harness/jobs').stop(req.params.job) }; }));

  // The project's conversation: its bound work chat, made on first use.
  app.post('/api/projects/:id/chat', h(req => ({ sessionId: projects.workChat(req.params.id).id })));
}

module.exports = { mount, detail };
