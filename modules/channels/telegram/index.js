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

const CAPS = { formFactor: 'other', input: { text: true, voice: true, camera: true, touch: true }, render: ['text', 'image'], ext: { channel: 'telegram' } };

const state = { running: false, bot: null, lastPollAt: null, error: null, ctrl: null };
const schema = () => require('../../settings-schema');
const pollSec = () => schema().value('channels.telegram.pollSec');
const enabled = () => schema().value('channels.telegram.enabled') === true && !!api.token();
const bind = require('../bind').binder({ label: 'Telegram', links, caps: CAPS,
  onEvent: (chatId, deviceId, env) => require('./outbound').onEvent(Number(chatId), deviceId, env), onError: e => { state.error = e.message; } });
const { queue, attach } = bind;

/** Bind a chat to a person: a `channel` device in their name, and a conversation of its own. */
function link(tgChat, userId) {
  const who = [tgChat.first_name, tgChat.last_name].filter(Boolean).join(' ') || tgChat.username || String(tgChat.id);
  return bind.link(tgChat.id, { who, username: tgChat.username || null }, userId);
}

/** Unlink: the device is revoked (so nothing more reaches the chat) and the chat forgotten. */
function unlink(chatId) {
  const c = bind.unlink(chatId);
  if (c) api.call('sendMessage', { chat_id: Number(chatId), text: 'This chat was unlinked from DOCA.' }).catch(() => {});
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
  bind.attachAll();
  poll(ctrl.signal).finally(() => { if (state.ctrl === ctrl) state.running = false; });
  return status();
}

function stop() {
  state.ctrl?.abort();
  state.ctrl = null;
  state.running = false;
  bind.detachAll();
}

function status() {
  const p = api.prefs();
  return { env: ['TELEGRAM_BOT_TOKEN'].filter(k => process.env[k]), enabled: p.enabled === true, hasToken: !!api.token(), running: state.running, error: state.error, lastPollAt: state.lastPollAt,
    bot: state.bot && { id: state.bot.id, username: state.bot.username, name: state.bot.first_name } };
}

module.exports = { start, stop, status, link, unlink, attach, bind };
