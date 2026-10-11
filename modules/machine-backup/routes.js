'use strict';

/**
 * /api/machine-backup — Settings → Backups → This machine's files. A host's (auth/rights.js): it is this machine's own
 * files. Setting the backup up, joining one, changing its password and every restore ask for the person's password
 * again (auth/guarded.js) — the first two hand a secret to the page once, the last replace files on disk.
 */
const config = require('./config');
const state = require('./state');
const folders = require('./folders');
const destination = require('./destination');
const schedule = require('./schedule');
const runner = require('./runner');
const restic = require('./restic');

const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, code: e.code });
const person = req => req.user ? { id: req.user.id, name: req.user.name, email: req.user.email } : null;
const wrap = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { fail(res, e); } };

/** Everything the card draws, in one read: no secret, only whether there is one. */
async function status() {
  const cfg = config.get(), st = state.get();
  const dest = destination.check(cfg.repo);
  const sugg = folders.suggestions();
  const now = Date.now();
  const r = { ...schedule.readings(now), reachable: dest.reachable };
  const last = state.runs()[0] || null;
  return {
    config: cfg, ...config.secretsView(), restic: await restic.available(), destination: dest,
    setUp: !!config.password() && !!cfg.repo, suggestions: sugg, usingSuggestions: !cfg.folders.length,
    platform: process.platform, home: require('os').homedir(), excludeDefault: require('./schema').keys.exclude.default,
    running: runner.running(), next: schedule.nextAt(r), due: schedule.due(r),
    lastOkAt: st.lastOkAt || null, lastTriedAt: st.lastTriedAt || null, lastError: st.lastError || null, lastRun: last,
  };
}

function mount(app) {
  app.get ('/api/machine-backup', wrap(() => status()));
  app.post('/api/machine-backup/settings', wrap(req => { const b = req.body || {};
    config.set(b);
    if (b.remote && (b.remote.id !== undefined || b.remote.secret !== undefined)) config.saveRemoteKeys(b.remote);
    return status(); }));
  // Set up (a new repository: the password comes back once), join an existing one, a new password.
  app.post('/api/machine-backup/setup', wrap(req => require('./setup').create(req.body || {}, person(req))));
  app.post('/api/machine-backup/connect', wrap(req => require('./setup').connect(req.body || {}, person(req))));
  app.post('/api/machine-backup/password', wrap(req => require('./setup').changePassword(req.body || {}, person(req))));
  // Back up now: it runs on; the card follows it through GET /api/machine-backup's `running`.
  app.post('/api/machine-backup/run', (req, res) => {
    if (runner.running()) return res.status(409).json({ error: 'A backup of this machine is already running.' });
    if (!config.password() || !config.get().repo) return res.status(409).json({ error: 'Set the backup up first.' });
    runner.run({ why: 'asked for now (Back up now)', person: person(req) }).catch(() => { /* written down */ });
    res.status(202).json({ started: true });
  });
  app.get ('/api/machine-backup/history', wrap(async () => ({ snapshots: await require('./browse').snapshots(), runs: state.runs() })));
  app.get ('/api/machine-backup/browse', wrap(async req => ({ entries: await require('./browse').list(req.query.snapshot, req.query.path || '') })));
  app.get ('/api/machine-backup/find', wrap(req => require('./browse').find(req.query.q)));
  app.get ('/api/machine-backup/download', async (req, res) => {
    try { await require('./browse').download(req.query.snapshot, req.query.path, { dir: req.query.dir === '1', res }); }
    catch (e) { if (!res.headersSent) fail(res, e); else res.end(); }
  });
  app.post('/api/machine-backup/restore', wrap(req => { const b = req.body || {};
    return b.mode === 'home' ? require('./restore').home(b, person(req)) : require('./restore').one(b, person(req)); }));
}

module.exports = { mount, status };
