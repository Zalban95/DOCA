'use strict';

/**
 * Settings → Channels → Matrix. The homeserver, the bot account's token and the switch are a host's (the bot
 * answers as the hive); a link code is anyone's who may chat — it binds the room it is sent from to *them*; a
 * person sees and unlinks their own rooms, a host every room.
 */
const mx = require('./index');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const me = req => req.auth?.user?.id || null;
const hostOf = req => !!req.auth && require('../../auth/rights').can(req.auth.role, 'host');

function view(req, host) {
  const all = Object.entries(mx.links.chats()).map(([room, c]) => ({ chatId: room, name: c.name, username: c.username, person: c.personName,
    userId: c.userId, deviceId: c.deviceId, linkedAt: c.linkedAt }));
  return { ...mx.status(), chats: host ? all : all.filter(c => c.userId === me(req)) };
}

function mount(app) {
  app.get('/api/channels/matrix', h(req => view(req, hostOf(req))));
  app.post('/api/channels/matrix', h(async req => {
    if (!hostOf(req)) throw Object.assign(new Error('Only a host sets up the Matrix bot.'), { status: 403 });
    const b = req.body || {};
    const { loadPrefs, savePrefs } = require('../../utils');
    const prefs = loadPrefs();
    const next = { ...(prefs.channels?.matrix || {}), ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}) };
    if (typeof b.homeserver === 'string') {
      const hs = b.homeserver.trim().replace(/\/+$/, '');
      if (hs && !/^https?:\/\/[^\s/]+/.test(hs)) throw Object.assign(new Error('The homeserver is an address like https://matrix.example.org.'), { status: 400 });
      next.homeserver = hs;
    }
    if (typeof b.accessToken === 'string' && b.accessToken !== require('../../secrets-mask').MASK) next.accessToken = b.accessToken.trim();
    savePrefs({ ...prefs, channels: { ...(prefs.channels || {}), matrix: next } });
    await mx.start();
    return view(req, true);
  }));
  app.post('/api/channels/matrix/link', h(req => {
    if (!me(req)) throw Object.assign(new Error('Sign in first.'), { status: 401 });
    const { code, expiresAt } = mx.links.newCode(me(req));
    return { code, expiresAt, bot: mx.status().bot?.username || null };
  }));
  app.delete('/api/channels/matrix/chats/:room', h(req => {
    const c = mx.links.chat(req.params.room);
    if (!c || (!hostOf(req) && c.userId !== me(req))) throw Object.assign(new Error('No such room.'), { status: 404 });
    mx.unlink(req.params.room);
    return { unlinked: req.params.room };
  }));
}

module.exports = { mount };
