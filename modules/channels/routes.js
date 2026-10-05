'use strict';

/**
 * Settings → Channels, for a channel on the shared core (matrix, slack): `GET /api/channels/<name>` (its state and
 * the linked chats a person may see — their own, or every one for a host), `POST` (its settings and switch: a
 * host's, since the bot answers as the hive), `POST …/link` (a one-time code binding the chat it is sent from to
 * the signed-in person) and `DELETE …/chats/:chat` (unlink: their own, or any for a host).
 *
 *   mount(app, { name, label, mod, settings(body, next) })   — settings copies the channel's own fields into next,
 *   with secrets kept when the panel sends back the mask.
 */
const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const me = req => req.auth?.user?.id || null;
const hostOf = req => !!req.auth && require('../auth/rights').can(req.auth.role, 'host');
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
/** A secret from the panel: the mask means unchanged. */
const secret = (b, key, next) => { if (typeof b[key] === 'string' && b[key] !== require('../secrets-mask').MASK) next[key] = b[key].trim(); };

function mount(app, { name, label, mod, settings }) {
  const view = (req, host) => {
    const all = Object.entries(mod.links.chats()).map(([chatId, c]) => ({ chatId, name: c.name, username: c.username, person: c.personName,
      userId: c.userId, deviceId: c.deviceId, linkedAt: c.linkedAt }));
    return { ...mod.status(), chats: host ? all : all.filter(c => c.userId === me(req)) };
  };
  app.get(`/api/channels/${name}`, h(req => view(req, hostOf(req))));
  app.post(`/api/channels/${name}`, h(async req => {
    if (!hostOf(req)) throw bad(`Only a host sets up the ${label} bot.`, 403);
    const b = req.body || {};
    const { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs();
    const next = { ...(prefs.channels?.[name] || {}), ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}) };
    settings(b, next);
    savePrefs({ ...prefs, channels: { ...(prefs.channels || {}), [name]: next } });
    await mod.start();
    return view(req, true);
  }));
  app.post(`/api/channels/${name}/link`, h(req => {
    if (!me(req)) throw bad('Sign in first.', 401);
    const { code, expiresAt } = mod.links.newCode(me(req));
    return { code, expiresAt, bot: mod.status().bot?.username || null };
  }));
  app.delete(`/api/channels/${name}/chats/:chat`, h(req => {
    const c = mod.links.chat(req.params.chat);
    if (!c || (!hostOf(req) && c.userId !== me(req))) throw bad('No such chat.', 404);
    mod.unlink(req.params.chat);
    return { unlinked: req.params.chat };
  }));
}

module.exports = { mount, secret, bad };
