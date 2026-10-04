'use strict';

/**
 * Settings → Channels → Telegram. The token and the switch are a host's (a bot answers as the hive); making
 * a link code is anyone's who may chat — the code binds the chat it is sent from to *them*; a person sees and
 * unlinks their own chats, a host every chat.
 */
const tg = require('./index');
const links = require('./links');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const me = req => req.auth?.user?.id || null;

function view(req, host) {
  const all = Object.entries(links.chats()).map(([chatId, c]) => ({ chatId, name: c.name, username: c.username, person: c.personName,
    userId: c.userId, deviceId: c.deviceId, linkedAt: c.linkedAt }));
  return { ...tg.status(), chats: host ? all : all.filter(c => c.userId === me(req)) };
}

function mount(app) {
  app.get('/api/channels/telegram', h(req => view(req, hostOf(req))));
  app.post('/api/channels/telegram', h(async req => {
    if (!hostOf(req)) throw Object.assign(new Error('Only a host sets up the Telegram bot.'), { status: 403 });
    const b = req.body || {};
    const { loadPrefs, savePrefs } = require('../../utils');
    const prefs = loadPrefs();
    const cur = prefs.channels?.telegram || {};
    const next = { ...cur, ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}) };
    if (typeof b.botToken === 'string' && b.botToken !== require('../../secrets-mask').MASK) next.botToken = b.botToken.trim();
    savePrefs({ ...prefs, channels: { ...(prefs.channels || {}), telegram: next } });
    await tg.start();
    return view(req, true);
  }));
  app.post('/api/channels/telegram/link', h(req => {
    if (!me(req)) throw Object.assign(new Error('Sign in first.'), { status: 401 });
    const { code, expiresAt } = links.newCode(me(req));
    const bot = tg.status().bot?.username;
    return { code, expiresAt, link: bot ? `https://t.me/${bot}?start=${code}` : null, bot };
  }));
  app.delete('/api/channels/telegram/chats/:chatId', h(req => {
    const c = links.chat(req.params.chatId);
    if (!c || (!hostOf(req) && c.userId !== me(req))) throw Object.assign(new Error('No such chat.'), { status: 404 });
    tg.unlink(req.params.chatId);
    return { unlinked: req.params.chatId };
  }));
}

const hostOf = req => !!req.auth && require('../../auth/rights').can(req.auth.role, 'host');

module.exports = { mount };
