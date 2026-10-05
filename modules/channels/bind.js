'use strict';

/**
 * A linked chat is a client (PROTOCOL.md, kind `channel`): this binds one to a person and to the bus, whichever
 * channel it is on. `link` makes a `channel` device in the person's name with a conversation of its own;
 * `attach` subscribes that device to the bus and hands its events, in order per chat, to the channel's
 * `onEvent(addr, deviceId, env)`, acknowledging a durable one only after the channel delivered it — so an outage
 * replays it; `unlink` revokes the device, so nothing more reaches the chat.
 *
 *   binder({ name: 'matrix', label: 'Matrix', links, caps, onEvent, onError })
 */
const SCOPES = ['interact', 'harness:chat', 'harness:sessions'];

function binder({ label, links, caps, onEvent, onError = () => {} }) {
  const subs = new Map(), queues = new Map();

  /** One chat's work in order: a reply never overtakes the question before it. */
  function queue(addr, job) {
    const key = String(addr);
    const next = (queues.get(key) || Promise.resolve()).then(job).catch(e => onError(e));
    queues.set(key, next);
    return next;
  }

  function attach(addr) {
    const key = String(addr);
    const c = links.chat(key);
    if (!c || subs.has(key)) return;
    const bus = require('../api-v1/bus');
    const handle = env => queue(key, async () => {
      await onEvent(key, c.deviceId, env);
      if (env.ack) bus.ackUpTo(c.deviceId, env.seq);
    });
    const sub = bus.subscribe(c.deviceId, 0, { send: handle });
    for (const env of sub.replay) handle(env);
    subs.set(key, sub);
  }

  function detach(addr) { subs.get(String(addr))?.unsubscribe(); subs.delete(String(addr)); }
  const attachAll = () => { for (const id of Object.keys(links.chats())) attach(id); };
  const detachAll = () => { for (const id of [...subs.keys()]) detach(id); };

  /** Bind a chat (`addr`, shown as `who`) to a person: a device in their name, and a conversation of its own. */
  function link(addr, { who, username = null }, userId) {
    const devices = require('../api-v1/devices');
    const key = String(addr);
    const old = links.chat(key);
    if (old) { detach(key); try { devices.revoke(old.deviceId); } catch { /* gone */ } }
    const { device } = devices.create({ name: `${label} · ${who}`.slice(0, 60), kind: 'channel', scopes: SCOPES, caps });
    devices.update(device.id, { userId });
    const session = require('../api-v1/harness').createSession(label, { activate: false, device: devices.get(device.id) });
    const person = require('../auth/store').userById(userId);
    const c = links.saveChat(key, { deviceId: device.id, userId, sessionId: session.id, name: who, username,
      personName: person?.name || person?.email || 'you', linkedAt: new Date().toISOString() });
    attach(key);
    return c;
  }

  /** Unlink: the device is revoked and the chat forgotten. Returns what was linked, or null. */
  function unlink(addr) {
    const c = links.removeChat(addr);
    if (!c) return null;
    detach(addr);
    try { require('../api-v1/devices').revoke(c.deviceId); } catch { /* gone */ }
    return c;
  }

  return { queue, attach, detach, attachAll, detachAll, link, unlink };
}

module.exports = { binder, SCOPES };
