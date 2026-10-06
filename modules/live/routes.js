'use strict';

/**
 * The live feed's routes (TODO H10.5). `GET /api/live/stream` is one SSE stream per open page: first `{hello, screen}`,
 * then every change this viewer may see — a conversation they may open (session-access, the same rule as the
 * transcript's route), the missions of those conversations, and, for someone holding host, the folders this page
 * asked to watch. `POST /api/live/watch {screen, folders}` says which folders those are now (host: the Files and
 * Projects tabs are). A heartbeat every 20 s keeps proxies from closing a quiet stream.
 */
const crypto = require('crypto');
const live = require('./index');
const watch = require('./watch');

const _open = new Map();      // screen → the person it streams for (so only they set its folders)
const _folders = new Map();   // screen → the folders its stream passes `files` changes for

function visible(change, person, host) {
  if (change.topic === 'files') return false;   // only through the screen's own folders, below
  if (host) return true;
  const access = require('../harness/session-access');
  if (change.topic === 'conversation') return access.mayUse(person, change.id);
  if (change.topic === 'missions') return !!change.sessionId && access.mayUse(person, change.sessionId);
  return false;
}

function stream(req, res) {
  require('../utils').sseHeaders(res);
  const person = require('../harness/turn/client').dashboardClient(req).user;
  const host = !person?.id || require('../harness/session-access').isHost(person);
  const screen = crypto.randomBytes(9).toString('base64url');
  _open.set(screen, person?.id || null);
  const send = o => { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch { /* gone */ } };
  const mine = new Set();   // this screen's folders, as watch.set() last held them
  const own = req.auth?.session?.screen || null;   // this browser's screen: a page sent to it is for it alone
  const on = change => {
    if (change.topic === 'files') { if (host && mine.has(change.id)) send(change); return; }
    if (change.topic === 'screen') { if (own && change.id === own) send(change); return; }
    if (visible(change, person, host)) send(change);
  };
  live.feed.on('change', on);
  const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch { /* gone */ } }, 20000);
  send({ hello: true, screen, host });
  _folders.set(screen, mine);
  res.on('close', () => { live.feed.off('change', on); clearInterval(beat); watch.release(screen); _open.delete(screen); _folders.delete(screen); });
}

function setWatch(req, res) {
  const screen = String(req.body?.screen || '');
  const me = require('../harness/turn/client').dashboardClient(req).user?.id || null;
  if (!_open.has(screen) || _open.get(screen) !== me) return res.status(404).json({ error: 'No such live stream on this page; it reconnects by itself.' });
  const held = watch.set(screen, Array.isArray(req.body?.folders) ? req.body.folders : []);
  const mine = _folders.get(screen);
  mine.clear(); held.forEach(f => mine.add(f));
  res.json({ ok: true, watching: held });
}

function mount(app) {
  live.start();
  app.get('/api/live/stream', stream);
  app.post('/api/live/watch', setWatch);
}

module.exports = { mount, visible };
