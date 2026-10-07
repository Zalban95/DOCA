'use strict';

/**
 * Realtime voice's doors (index.js has the call itself).
 *
 *   GET  /api/realtime          what a call would use, and whether it is on (right chat)
 *   POST /api/realtime          the owner sets it: protocol, provider, url, model, voice, dialect, waitSec (host)
 *   WS   /ws/realtime           the panel's call, as the signed-in person (right chat, the panel's own page)
 *   GET  /api/v1/realtime       the same status for a paired device (harness:chat)
 *   WS   /api/v1/realtime       a device's call, with its bearer token (header, or ?access_token= where a client
 *                               cannot set one) — its person, level and approvals, as harness.post() gives every device;
 *                               ?session= one of the person's conversations, else the one its typed messages go to
 *   GET  /api/v1/call           a device's live call by whichever engine this hub has (harness:chat)
 *   WS   /api/v1/call           the same wire as /api/v1/realtime: the realtime model when one is on, else the hive's own
 *                               STT, turn and TTS (pipeline.js) — what a watch's call reaches through its phone
 */
const rt = require('./index');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const KEYS = { protocol: /^(openai|gemini)$/, provider: /^[\w.-]{0,60}$/, url: /^(wss?:\/\/\S{3,500})?$/, model: /^[\w.:/@-]{0,120}$/, voice: /^[\w.-]{0,60}$/, dialect: /^(ga|beta)$/ };

function mount(app) {
  app.get('/api/realtime', h(() => ({ ...rt.status(), settings: rt.settings() })));
  app.post('/api/realtime', h(req => {
    const b = req.body || {};
    const { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs();
    const next = { ...(prefs.realtime || {}) };
    for (const [k, re] of Object.entries(KEYS)) if (typeof b[k] === 'string') {
      if (!re.test(b[k].trim())) throw Object.assign(new Error(`${k}: not a value this takes.`), { status: 400 });
      next[k] = b[k].trim();
    }
    if (b.waitSec !== undefined) { const n = Number(b.waitSec); if (!(n >= 3 && n <= 120)) throw Object.assign(new Error('waitSec: 3 to 120 seconds.'), { status: 400 }); next.waitSec = n; }
    savePrefs({ ...prefs, realtime: next });
    return { ...rt.status(), settings: rt.settings() };
  }));
}

/** GET /api/v1/realtime: the status, for a device about to call. */
function mountDevice(router) {
  router.get('/realtime', (req, res) => {
    if (!require('../api-v1/auth').can(req, 'harness:chat')) return res.status(403).json({ error: { code: 'scope_required', message: 'This device\'s token lacks harness:chat.' } });
    res.json(rt.status());
  });
  router.get('/call', async (req, res) => {
    if (!require('../api-v1/auth').can(req, 'harness:chat')) return res.status(403).json({ error: { code: 'scope_required', message: 'This device\'s token lacks harness:chat.' } });
    res.json(await rt.callStatus());
  });
}

let _wss = null;
const wss = () => (_wss = _wss || new (require('ws').WebSocketServer)({ noServer: true }));
const refuse = (socket, code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);

/** The panel's socket: the person signed in to this page. Returns false when the path is not ours. */
function upgradePanel(req, socket, head) {
  const who = require('../auth/gate').upgradeAllowed(req, 'chat');
  if (!who) return refuse(socket, 401, 'Unauthorized');
  const client = { ...require('../harness/turn/client').dashboardClient({ auth: who }), name: 'Live call (realtime voice)' };
  const access = require('../harness/session-access'), memory = require('../harness/memory');
  const asked = new URL(req.url, 'http://x').searchParams.get('session');
  let sessionId = access.isHost(client.user) ? memory.mainSession().id : access.defaultFor(client.user);   // as the floating chat and harness.post choose
  if (asked) {
    try { access.check(client.user, asked); sessionId = asked; } catch { return refuse(socket, 404, 'Not Found'); }
  }
  wss().handleUpgrade(req, socket, head, ws => rt.serve(ws, { sessionId, person: client.user, ask: rt.askAsPanel({ sessionId, client }) }));
}

/** A device's socket: its bearer token, harness:chat, its person's conversation. */
function upgradeDevice(req, socket, head, engine = 'realtime') {
  const devices = require('../api-v1/devices'), { hasScope } = require('../api-v1/scopes');
  const u = new URL(req.url, 'http://x');
  const token = (/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1] || u.searchParams.get('access_token');
  const device = token && devices.authenticate(String(token).trim());
  if (!device) return refuse(socket, 401, 'Unauthorized');
  if (device.userId) { const owner = require('../auth/store').userById(device.userId); if (!owner || owner.suspendedAt) return refuse(socket, 401, 'Unauthorized'); }
  if (!hasScope(device.scopes, 'harness:chat')) return refuse(socket, 403, 'Forbidden');
  const harness = require('../api-v1/harness');
  let sessionId = u.searchParams.get('session');
  // A call with no conversation named goes where the device's typed messages go (the Orchestrator's, for a host): one
  // conversation, so what the hive answers there later — a work chat's report, a mission — reaches the call (calls.js).
  try {
    if (sessionId) harness.requireSession(sessionId, device);
    else sessionId = harness.defaultSession(device).id;
  } catch { return refuse(socket, 404, 'Not Found'); }
  const person = require('../harness/turn/client').deviceOwner(device);
  wss().handleUpgrade(req, socket, head, ws => rt.serve(ws, { sessionId, engine, person, deviceId: device.id, ask: rt.askAsDevice(devices.get(device.id) || device, sessionId) }));
}

module.exports = { mount, mountDevice, upgradePanel, upgradeDevice };
