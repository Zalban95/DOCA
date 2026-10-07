'use strict';

/**
 * Matrix as a channel of the hive (TODO H9.1): a bot account on any homeserver — matrix.org, or one the person
 * runs on their own tailnet — that this hub syncs with (long-polled `/sync`, so no public address), whose direct
 * rooms are clients like a phone. Each room a person links is a device of kind `channel` bound to them; what it
 * writes is a turn in its own conversation (../converse.js) and what the hive says arrives on the bus
 * (outbound.js). An invitation is accepted; a room with more than the bot and one person is left.
 *
 * Not read: end-to-end encrypted rooms. Reading them needs an Olm/Megolm implementation and a device whose keys
 * this hub keeps — a dependency and a secret store of their own. An encrypted message is answered with how to
 * start an unencrypted direct chat instead.
 *
 * Off until a host saves a homeserver and an access token and switches it on; `start()` runs in the listen path
 * (boot.js), never in createApp.
 */
const api = require('./api');
const links = require('../links').forChannel('matrix');

const CAPS = { formFactor: 'other', input: { text: true, voice: true, camera: true, touch: false }, render: ['text', 'image'], ext: { channel: 'matrix' } };
const state = { running: false, me: null, lastPollAt: null, error: null, ctrl: null, dms: new Set() };
const schema = () => require('../../settings-schema');
const pollSec = () => schema().value('channels.matrix.pollSec');
const enabled = () => schema().value('channels.matrix.enabled') === true && !!api.token() && !!api.base();
const bind = require('../bind').binder({ label: 'Matrix', links, caps: CAPS,
  onEvent: (room, deviceId, env) => require('./outbound').onEvent(room, deviceId, env), onError: e => { state.error = e.message; } });

const ENCRYPTED = 'This room is end-to-end encrypted, which DOCA cannot read. Start a direct chat with encryption switched off (Element: "Start chat" → show advanced → disable encryption).';

/** A direct room: the bot and one person. Asked once a room, then remembered. */
async function direct(room) {
  if (state.dms.has(room)) return true;
  const joined = Object.keys((await api.members(room)).joined || {});
  if (joined.length > 2) return false;
  state.dms.add(room);
  return true;
}

async function onInvite(room) {
  await api.join(room);
  if (!await direct(room)) {
    await require('./outbound').say(room, 'I answer in a direct chat only.').catch(() => {});
    await api.leave(room).catch(() => {});
    return;
  }
  if (!links.chat(room)) await require('./outbound').say(room, require('../converse').howto('Matrix'));
}

async function onRoomEvent(room, ev) {
  if (ev.sender === state.me) return;
  const say = t => require('./outbound').say(room, t);
  if (ev.type === 'm.room.encrypted') return void await say(ENCRYPTED);
  if (ev.type !== 'm.room.message' || !ev.content) return;
  if (!await direct(room)) return;
  const ct = ev.content;
  const file = ['m.image', 'm.file', 'm.audio', 'm.video'].includes(ct.msgtype) && ct.url ? ct : null;
  if (ct.file && !ct.url) return void await say(ENCRYPTED);
  const text = file ? '' : String(ct.body || '');
  const keep = file ? async deviceId => require('../converse').keepFile({ buffer: await api.download(file.url), name: String(file.body || 'matrix-file').slice(0, 120),
    mime: file.info?.mimetype, speech: file.msgtype === 'm.audio' }, deviceId) : undefined;
  await require('../converse').handle({ label: 'Matrix', links, bind, say: (r, t) => require('./outbound').say(r, t), answer: require('./outbound').answer },
    { addr: room, text, from: { who: ev.sender, username: ev.sender }, keep });
}

async function poll(signal) {
  let backoff = 1000;
  if (!links.offset('')) {
    // First start: where the rooms are now, without answering their history.
    const first = await api.sync({ timeoutMs: 0, filter: { room: { timeline: { limit: 0 } } } }, signal);
    links.setOffset(first.next_batch);
  }
  while (!signal.aborted) {
    try {
      const s = await api.sync({ since: links.offset(''), timeoutMs: pollSec() * 1000 }, signal);
      state.lastPollAt = new Date().toISOString(); state.error = null; backoff = 1000;
      for (const room of Object.keys(s.rooms?.invite || {})) await bind.queue(room, () => onInvite(room));
      for (const [room, r] of Object.entries(s.rooms?.join || {}))
        for (const ev of r.timeline?.events || []) await bind.queue(room, () => onRoomEvent(room, ev));
      for (const room of Object.keys(s.rooms?.leave || {})) state.dms.delete(room);
      links.setOffset(s.next_batch);
      if (pollSec() === 0) await new Promise(r => setTimeout(r, 200));
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
  try { state.me = (await api.whoami()).user_id; state.error = null; }
  catch (e) { state.error = e.message; state.ctrl = null; return status(); }
  state.running = true;
  bind.attachAll();
  poll(ctrl.signal).catch(e => { state.error = e.message; }).finally(() => { if (state.ctrl === ctrl) state.running = false; });
  return status();
}

function stop() {
  state.ctrl?.abort();
  state.ctrl = null;
  state.running = false;
  bind.detachAll();
}

function unlink(room) {
  const c = bind.unlink(room);
  if (c) require('./outbound').say(room, 'This chat was unlinked from DOCA.').catch(() => {});
  return c;
}

function status() {
  const p = api.prefs();
  return { env: ['MATRIX_HOMESERVER', 'MATRIX_ACCESS_TOKEN'].filter(k => process.env[k]), enabled: p.enabled === true, homeserver: api.base() || null, hasToken: !!api.token(), running: state.running,
    error: state.error, lastPollAt: state.lastPollAt, bot: state.me ? { username: state.me } : null };
}

const me = () => state.me;

module.exports = { start, stop, status, unlink, bind, links, me };
