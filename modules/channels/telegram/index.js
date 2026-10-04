'use strict';

/**
 * Telegram as a channel of the hive (TODO H14, H9.1; OpenDots parity): a bot this hub polls — no public
 * address needed, which a hub on a tailnet does not have — whose linked private chats are clients like a
 * phone. Each chat is a device of kind `channel`, bound to the person who linked it; what it writes is a
 * turn in its own conversation (inbound.js) and what the hive says to it arrives on the bus (outbound.js).
 *
 * Off until a host saves a bot token and switches it on (prefs `channels.telegram`); `start()` runs in the
 * listen path (boot.js), never in createApp, so requiring the app polls nobody.
 */
const api = require('./api');
const links = require('./links');

const SCOPES = ['interact', 'harness:chat', 'harness:sessions'];
const CAPS = { formFactor: 'other', input: { text: true, voice: true, camera: true, touch: true }, render: ['text', 'image'], ext: { channel: 'telegram' } };

const state = { running: false, bot: null, lastPollAt: null, error: null, ctrl: null, subs: new Map(), queues: new Map() };
const schema = () => require('../../settings-schema');
const pollSec = () => schema().value('channels.telegram.pollSec');
const enabled = () => schema().value('channels.telegram.enabled') === true && !!api.token();

/** One chat's events in order: a reply never overtakes the question before it. */
function queue(chatId, job) {
  const next = (state.queues.get(chatId) || Promise.resolve()).then(job).catch(e => { state.error = e.message; });
  state.queues.set(chatId, next);
  return next;
}

function attach(chatId) {
  const c = links.chat(chatId);
  if (!c || state.subs.has(String(chatId))) return;
  const bus = require('../../api-v1/bus');
  const handle = env => queue(String(chatId), async () => {
    await require('./outbound').onEvent(Number(chatId), c.deviceId, env);
    if (env.ack) bus.ackUpTo(c.deviceId, env.seq);
  });
  const sub = bus.subscribe(c.deviceId, 0, { send: handle });
  for (const env of sub.replay) handle(env);
  state.subs.set(String(chatId), sub);
}

function detach(chatId) { state.subs.get(String(chatId))?.unsubscribe(); state.subs.delete(String(chatId)); }

/** Bind a chat to a person: a `channel` device in their name, and a conversation of its own. */
async function link(tgChat, userId) {
  const devices = require('../../api-v1/devices');
  const old = links.chat(tgChat.id);
  if (old) { detach(tgChat.id); try { devices.revoke(old.deviceId); } catch { /* gone */ } }
  const who = [tgChat.first_name, tgChat.last_name].filter(Boolean).join(' ') || tgChat.username || String(tgChat.id);
  const { device } = devices.create({ name: `Telegram · ${who}`.slice(0, 60), kind: 'channel', scopes: SCOPES, caps: CAPS });
  devices.update(device.id, { userId });
  const full = devices.get(device.id);
  const session = require('../../api-v1/harness').createSession('Telegram', { activate: false, device: full });
  const person = require('../../auth/store').userById(userId);
  const c = links.saveChat(tgChat.id, { deviceId: device.id, userId, sessionId: session.id, name: who, username: tgChat.username || null,
    personName: person?.name || person?.email || 'you', linkedAt: new Date().toISOString() });
  attach(tgChat.id);
  return c;
}

/** Unlink: the device is revoked (so nothing more reaches the chat) and the chat forgotten. */
function unlink(chatId) {
  const c = links.removeChat(chatId);
  if (!c) return null;
  detach(chatId);
  try { require('../../api-v1/devices').revoke(c.deviceId); } catch { /* gone */ }
  api.call('sendMessage', { chat_id: Number(chatId), text: 'This chat was unlinked from DOCA.' }).catch(() => {});
  return c;
}

async function poll(signal) {
  const { onMessage, onCallback } = require('./inbound');
  let backoff = 1000;
  while (!signal.aborted) {
    try {
      const ups = await api.call('getUpdates', { offset: links.offset(), timeout: pollSec(), allowed_updates: ['message', 'callback_query'] },
        { signal, timeoutMs: (pollSec() + 15) * 1000 });
      state.lastPollAt = new Date().toISOString(); state.error = null; backoff = 1000;
      for (const u of ups) {
        links.setOffset(u.update_id + 1);
        const chatId = String(u.message?.chat?.id || u.callback_query?.message?.chat?.id || '');
        await queue(chatId, () => (u.callback_query ? onCallback(u.callback_query, module.exports) : u.message ? onMessage(u.message, module.exports) : null));
      }
      if (!ups.length && pollSec() === 0) await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      if (signal.aborted) break;
      state.error = e.message;
      await new Promise(r => setTimeout(r, e.retryAfter ? e.retryAfter * 1000 : backoff));
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

async function start() {
  stop();
  if (!enabled()) return status();
  const ctrl = new AbortController();
  state.ctrl = ctrl;
  try { state.bot = await api.call('getMe'); state.error = null; }
  catch (e) { state.error = e.message; state.ctrl = null; return status(); }
  state.running = true;
  for (const id of Object.keys(links.chats())) attach(id);
  poll(ctrl.signal).finally(() => { if (state.ctrl === ctrl) state.running = false; });
  return status();
}

function stop() {
  state.ctrl?.abort();
  state.ctrl = null;
  state.running = false;
  for (const id of [...state.subs.keys()]) detach(id);
}

function status() {
  const p = api.prefs();
  return { enabled: p.enabled === true, hasToken: !!api.token(), running: state.running, error: state.error, lastPollAt: state.lastPollAt,
    bot: state.bot && { id: state.bot.id, username: state.bot.username, name: state.bot.first_name } };
}

module.exports = { start, stop, status, link, unlink, attach, SCOPES };
