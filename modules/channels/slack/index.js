'use strict';

/**
 * Slack as a channel of the hive (TODO H9.1): a Slack app in Socket Mode — the hub opens a WebSocket to Slack,
 * so no public address and no request URL are needed — whose direct messages are clients like a phone. Each DM a
 * person links is a device of kind `channel` bound to them; what it writes is a turn in its own conversation
 * (../converse.js) and what the hive says arrives on the bus (outbound.js). Every envelope is acknowledged at
 * once, as Socket Mode requires, and handled after; a `disconnect` or a dropped socket opens a fresh one.
 *
 * Direct messages only: a channel message, even one mentioning the bot, gets nothing — a hive answering in a
 * shared channel would be answering as one person to many. Off until a host saves both tokens and switches it on;
 * `start()` runs in the listen path (boot.js), never in createApp.
 */
const api = require('./api');
const links = require('../links').forChannel('slack');

const CAPS = { formFactor: 'other', input: { text: true, voice: true, camera: true, touch: true }, render: ['text', 'image'], ext: { channel: 'slack' } };
const state = { running: false, me: null, team: null, connectedAt: null, error: null, ws: null, stopped: true, names: new Map() };
const schema = () => require('../../settings-schema');
const enabled = () => schema().value('channels.slack.enabled') === true && !!api.appToken() && !!api.botToken();
const bind = require('../bind').binder({ label: 'Slack', links, caps: CAPS,
  onEvent: (ch, deviceId, env) => require('./outbound').onEvent(ch, deviceId, env), onError: e => { state.error = e.message; } });

async function nameOf(user) {
  if (state.names.has(user)) return state.names.get(user);
  const u = await api.call('users.info', { user }).then(r => r.user).catch(() => null);
  const name = u?.profile?.real_name || u?.real_name || u?.name || user;
  state.names.set(user, name);
  return name;
}

async function onMessage(ev) {
  if (ev.channel_type !== 'im' || ev.bot_id || ev.user === state.me || (ev.subtype && ev.subtype !== 'file_share')) return;
  const file = (ev.files || [])[0];
  const keep = file?.url_private ? async deviceId => require('../converse').keepFile({ buffer: await api.download(file.url_private),
    name: String(file.name || 'slack-file').slice(0, 120), mime: file.mimetype, speech: /^audio\//.test(file.mimetype || '') || file.subtype === 'slack_audio' }, deviceId) : undefined;
  await require('../converse').handle({ label: 'Slack', links, bind, say: (c, t) => require('./outbound').say(c, t) },
    { addr: ev.channel, text: ev.text || '', from: { who: await nameOf(ev.user), username: ev.user }, keep });
}

function onEnvelope(ws, msg) {
  if (msg.envelope_id) ws.send(JSON.stringify({ envelope_id: msg.envelope_id }));
  if (msg.type === 'disconnect') return void ws.close();
  if (msg.type === 'events_api' && msg.payload?.event?.type === 'message') {
    const ev = msg.payload.event;
    bind.queue(ev.channel, () => onMessage(ev));
  }
  if (msg.type === 'interactive' && msg.payload?.type === 'block_actions') {
    const p = msg.payload;
    bind.queue(p.channel?.id, () => require('./outbound').onAction(p));
  }
}

async function connect(attempt = 0) {
  if (state.stopped) return;
  let ws;
  try {
    const WebSocket = require('ws');
    ws = new WebSocket(await api.socketUrl());
  } catch (e) {
    state.error = e.message;
    return void setTimeout(() => connect(attempt + 1), Math.min(60000, 1000 * 2 ** attempt)).unref();
  }
  state.ws = ws;
  ws.on('open', () => { state.connectedAt = new Date().toISOString(); state.error = null; attempt = 0; });
  ws.on('message', data => { try { onEnvelope(ws, JSON.parse(String(data))); } catch (e) { state.error = e.message; } });
  ws.on('error', e => { state.error = e.message; });
  ws.on('close', () => {
    if (state.ws === ws) state.ws = null;
    if (!state.stopped) setTimeout(() => connect(attempt + 1), Math.min(60000, 500 * 2 ** attempt)).unref();
  });
}

async function start() {
  stop();
  if (!enabled()) return status();
  try { const a = await api.call('auth.test'); state.me = a.user_id; state.team = a.team; state.error = null; }
  catch (e) { state.error = e.message; return status(); }
  state.stopped = false;
  state.running = true;
  bind.attachAll();
  await connect();
  return status();
}

function stop() {
  state.stopped = true;
  state.running = false;
  try { state.ws?.close(); } catch { /* gone */ }
  state.ws = null;
  bind.detachAll();
}

function unlink(ch) {
  const c = bind.unlink(ch);
  if (c) require('./outbound').say(ch, 'This chat was unlinked from DOCA.').catch(() => {});
  return c;
}

function status() {
  const p = api.prefs();
  return { env: ['SLACK_APP_TOKEN', 'SLACK_BOT_TOKEN'].filter(k => process.env[k]), enabled: p.enabled === true, hasAppToken: !!api.appToken(), hasBotToken: !!api.botToken(), running: state.running,
    connected: !!state.ws && state.ws.readyState === 1, error: state.error, connectedAt: state.connectedAt,
    bot: state.me ? { username: state.me, team: state.team } : null };
}

module.exports = { start, stop, status, unlink, bind, links };
