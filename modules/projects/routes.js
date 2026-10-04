'use strict';

/**
 * /api/projects — the Projects tab. Every route is the host right (a project
 * is files and a shell), and every one calls the same module the agent's tools
 * call. Files themselves are read and written through /api/files, as the Files
 * tab does: one implementation of "open a file", with its root checks.
 */
const path     = require('path');
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
  app.post('/api/projects/:id/replace', h(async req => {
    const p = P(req);
    // Applying writes many files at once: a checkpoint first, as discard and pull take (audit 2026-10-04).
    const checkpoint = req.body?.apply ? await require('./checkpoints').take(p, { label: `before replacing "${String(req.body.query || req.body.find || '').slice(0, 40)}"`, by: 'person' }).catch(() => null) : null;
    return { ...(await require('./search').replaceInFiles(p.root, { ...(req.body || {}), dryRun: !req.body?.apply })), ...(checkpoint ? { checkpoint: checkpoint.id } : {}) };
  }));

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
  // Managing the repository from the panel (./git-manage.js): init, remotes, fetch/pull/push, stash, discard.
  const gm = () => require('./git-manage');
  const cp = (p, label) => require('./checkpoints').take(p, { label, by: 'person' }).catch(() => null);
  app.post('/api/projects/:id/git/init', h(req => gm().init(P(req).root, { branch: req.body?.branch || 'main', commit: !!req.body?.commit })));
  app.get('/api/projects/:id/git/remotes', h(async req => ({ remotes: await gm().remotes(P(req).root), stashes: await gm().stashCount(P(req).root) })));
  app.post('/api/projects/:id/git/remote', h(async req => ({ remotes: await gm().setRemote(P(req).root, req.body || {}) })));
  app.post('/api/projects/:id/git/sync', h(async req => {
    const p = P(req), action = String(req.body?.action || '');
    const run = await gm().syncCommand(p.root, action);
    const checkpoint = action === 'pull' ? await cp(p, 'before git pull') : null;
    const job = require('../harness/jobs').start(run, { cwd: p.root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' } });
    return { job, command: { run }, checkpoint: checkpoint && !checkpoint.unchanged ? checkpoint.id : checkpoint?.id || null };
  }));
  app.post('/api/projects/:id/git/discard', h(async req => {
    const p = P(req);
    const checkpoint = await cp(p, `before discarding ${[].concat(req.body?.files || []).slice(0, 3).join(', ')}`);
    // Without its checkpoint a discard cannot be undone: say so and wait for force (audit 2026-10-04).
    if (!checkpoint && !req.body?.force)
      throw Object.assign(new Error('A checkpoint could not be taken first (is git installed?), so this discard could not be undone. Send force to discard anyway.'), { status: 409 });
    return { ...(await gm().discard(p.root, req.body?.files)), checkpoint: checkpoint?.id || null };
  }));
  app.post('/api/projects/:id/git/stash', h(req => gm().stash(P(req).root, { pop: !!req.body?.pop })));
  app.post('/api/projects/:id/git/switch', h(req => git.checkout(P(req).root, req.body?.branch, { create: !!req.body?.create })));

  app.post('/api/projects/:id/run', h(async req => {
    const r = await require('./run').run(req.params.id, String(req.body?.command || ''), { waitSec: 0 });
    return { command: r.command, job: r.job };
  }));
  // A project's own jobs only — ones that ran in its folder — not any job by id (audit 2026-10-04).
  const projectJob = req => {
    const p = P(req), j = require('../harness/jobs').get(req.params.job);
    const inside = j?.cwd && (path.resolve(j.cwd) + path.sep).startsWith(path.resolve(p.root) + path.sep);
    if (!inside) throw Object.assign(new Error(`No job ${req.params.job} in ${p.name}.`), { status: 404 });
    return j;
  };
  app.get('/api/projects/:id/jobs/:job', h(req => {
    const jobs = require('../harness/jobs');
    projectJob(req);
    return { job: jobs.get(req.params.job), output: jobs.output(req.params.job, Number(req.query.bytes) || 64000) };
  }));
  app.post('/api/projects/:id/jobs/:job/stop', h(req => { projectJob(req); return { job: require('../harness/jobs').stop(req.params.job) }; }));

  // The project's environment (./env.js): the machine's runtimes, its own venv / node_modules, which is used.
  const envm = () => require('./env');
  app.get('/api/projects/:id/env', h(req => envm().view(P(req))));
  app.post('/api/projects/:id/env', h(req => { projects.update(req.params.id, { env: { python: req.body?.python ?? null } }); require('./brief').forget(req.params.id); return envm().view(P(req)); }));
  app.post('/api/projects/:id/env/setup', h(req => {
    const p = P(req);
    const s = envm().setupCommand(p, String(req.body?.action || ''), { dir: req.body?.dir || '.venv' });
    const job = require('../harness/jobs').start(envm().wrap(p, s.run), { cwd: p.root, env: envm().vars(p) });
    return { job, command: { run: s.run }, then: s.then || null };
  }));
  // Checkpoints (./checkpoints.js): undo for agent runs.
  const cps = () => require('./checkpoints');
  app.get('/api/projects/:id/checkpoints', h(req => ({ checkpoints: cps().list(P(req)) })));
  app.post('/api/projects/:id/checkpoints', h(async req => ({ checkpoint: await cps().take(P(req), { label: req.body?.label || 'checkpoint', by: 'person' }) })));
  app.get('/api/projects/:id/checkpoints/:cp/changes', h(async req => ({ changes: await cps().changes(P(req), req.params.cp) })));
  app.get('/api/projects/:id/checkpoints/:cp/diff', h(async req => ({ diff: await cps().fileDiff(P(req), req.params.cp, String(req.query.file || '')) })));
  app.post('/api/projects/:id/checkpoints/:cp/restore', h(req => cps().restore(P(req), req.params.cp, { by: 'person' })));
  app.patch('/api/projects/:id/checkpoints/:cp', h(req => ({ checkpoint: cps().update(P(req), req.params.cp, req.body || {}) })));
  app.delete('/api/projects/:id/checkpoints/:cp', h(req => cps().remove(P(req), req.params.cp)));

  // Code intelligence (./lsp.js): which language servers are here, and installing the npm-based ones.
  app.get('/api/projects/lsp/servers', h(() => ({ servers: require('./lsp').status() })));
  app.post('/api/projects/lsp/servers/:name/install', h(req => require('./lsp').install(req.params.name)));

  // The project's conversation: its bound work chat, made on first use.
  app.post('/api/projects/:id/chat', h(req => ({ sessionId: projects.workChat(req.params.id).id })));
}

module.exports = { mount, detail };
