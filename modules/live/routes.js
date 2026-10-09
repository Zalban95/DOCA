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
const _hosts = new Set();     // screens whose person holds host (a notice for nobody in particular is theirs)

function visible(change, person, host) {
  if (change.topic === 'files') return false;   // only through the screen's own folders, below
  if (host) return true;
  const access = require('../harness/session-access');
  if (change.topic === 'conversation') return access.mayUse(person, change.id);
  if (change.topic === 'missions') return !!change.sessionId && access.mayUse(person, change.sessionId);
  if (change.topic === 'teams') return !!change.sessionId && access.mayUse(person, change.sessionId);   // a team, by its leader's conversation (teams/)
  if (change.topic === 'org') return !!person?.id;   // the organisation tree moved: every signed-in page may redraw it (org/)
  if (change.topic === 'schedules') return !!person?.id && change.by === person.id;   // their own schedules
  return false;
}

function stream(req, res) {
  require('../utils').sseHeaders(res);
  const person = require('../harness/turn/client').dashboardClient(req).user;
  const host = !person?.id || require('../harness/session-access').isHost(person);
  const screen = crypto.randomBytes(9).toString('base64url');
  _open.set(screen, person?.id || null);
  if (host) _hosts.add(screen);
  const send = o => { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch { /* gone */ } };
  const mine = new Set();   // this screen's folders, as watch.set() last held them
  const own = req.auth?.session?.screen || null;   // this browser's screen: a page sent to it is for it alone
  const on = change => {
    if (change.topic === 'files') { if (host && mine.has(change.id)) send(change); return; }
    if (change.topic === 'screen') { if (own && change.id === own) send(change); return; }
    if (change.topic === 'home') { if (require('../home').hears(screen, person, change.id, change)) send(change); return; }   // pages holding Home, entities their person may see
    // A mission's machine question (harness/mission-asks.js): only its person's pages — a host's when it has no person.
    if (change.topic === 'ask') { if (change.personId ? person?.id === change.personId : host) send(change); return; }
    if (change.topic === 'device') { if (require('../devices-approval').hears(person, change)) send(change); return; }   // a new device: whoever may approve it
    if (change.topic === 'chat') { if (person?.id && (change.to || []).includes(person.id)) send({ ...change, to: undefined }); return; }   // hive chat: its members alone, a host included (people/)
    if (change.topic === 'notice') { if (change.personId ? person?.id === change.personId : host) send(change); return; }   // notices/: theirs alone
    if (change.topic === 'meeting') { if (require('../meetings/rooms').hears(screen, person, change)) send(change); return; }   // a meeting's pages, or the people it rings (meetings/)
    if (change.topic === 'workstream') { if (host && require('../workstream').holds(screen)) send(change); return; }   // only pages holding it
    if (visible(change, person, host)) send(change);
  };
  live.feed.on('change', on);
  const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch { /* gone */ } }, 20000);
  send({ hello: true, screen, host });
  _folders.set(screen, mine);
  res.on('close', () => { live.feed.off('change', on); clearInterval(beat); watch.release(screen); _open.delete(screen); _hosts.delete(screen); _folders.delete(screen); live.feed.emit('screen-closed', screen); });
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

/** Whether `screen` is a live stream this request's person opened (so only they act for it). */
const owns = (req, screen) => _open.has(screen) && _open.get(screen) === (require('../harness/turn/client').dashboardClient(req).user?.id || null);

/** How many pages this person has open now (null: pages of someone holding host) — what a notice reached. */
const pagesOf = personId => (personId ? [..._open.values()].filter(v => v === personId).length : _hosts.size);

module.exports = { mount, visible, owns, pagesOf };
