'use strict';

/**
 * Casting through one of the person's devices (docs/design/cast-reach.md §1.4, §2.3; R3f, the owner's yes of
 * 2026-10-13): when the hub has no address on a thing's network (the hub at the office, the TV at home), a client that
 * saw it there and lends the `cast` family (PROTOCOL §22.5) opens a door of its own and does the casting itself.
 *   pick(who, t)              the person's own connected client that saw `t` most recently and lends cast_serve, or null
 *   show / say / stop / volume  the same acts as things.js, through it
 * A page: the client forwards the TV's requests to the hub, adding nothing (the hub sees the view link's own session).
 * A sound: its bytes go to the client with the cast and are served from there, to that device only — the hub's media
 * route is never opened to anyone. Nothing here widens who may cast: things.js has already checked the person may use
 * the thing; this only picks the way there, among the person's own devices — and the owner's switch for a plain-HTTP door
 * (cast.door) holds here as for the hub's own.
 */
const crypto = require('crypto');
const bad = (m, status = 502) => Object.assign(new Error(m), { status });

/** The person's own client that can cast to `t` (it saw it, and lends the cast family), newest sighting first. */
function pick(who, t) {
  const person = { id: who?.user?.id || null };
  const lookers = require('../nearby/lookers').clients(person);
  const reg = require('../mcp/registry');
  const casting = new Set(reg.list().filter(s => (s.tools || []).some(x => x.name === 'cast_serve')).map(s => s.id));
  for (const seen of (t.seenFrom || []).filter(x => x.by && x.by !== 'hub')) {
    const c = lookers.find(l => l.deviceId === seen.by && casting.has(l.id));
    if (c) return c;
  }
  return null;
}

async function call(c, tool, args) {
  const text = await require('../mcp/registry').client(c.id).callTool(tool, args);
  if (/^Error:/.test(text)) throw bad(`${c.label}: ${text.replace(/^Error:\s*/, '')}`);
  try { return JSON.parse(text); } catch { throw bad(`${c.label} answered ${tool} with something else: ${String(text).slice(0, 160)}`); }
}

const target = t => ({ address: t.how.cast.ip, port: Number(t.how.cast.port) || 8009 });
const castId = t => `cast-${t.id}`;

async function show(c, t, link) {
  require('./door').needOn();   // the same plain-HTTP way in, on the same kind of network: the owner's switch (cast.door)
  const { base } = await call(c, 'cast_serve', { cast: castId(t), target: t.how.cast.ip, page: true });
  const url = `${base}${link.path}`;
  await call(c, 'cast_send', { target: target(t), do: 'page', url });
  return { ok: true, url, via: c.label };
}

async function say(c, t, audio, title) {
  require('./door').needOn();
  const token = crypto.randomBytes(16).toString('hex');
  const { base } = await call(c, 'cast_serve', { cast: castId(t), target: t.how.cast.ip, media: [{ token, mime: audio.mime, data: audio.buffer.toString('base64') }] });
  await call(c, 'cast_send', { target: target(t), do: 'media', url: `${base}/api/cast/media/${token}`, contentType: audio.mime, title });
  return { ok: true, via: c.label };
}

async function stop(c, t) {
  await call(c, 'cast_send', { target: target(t), do: 'stop' });
  await call(c, 'cast_end', { cast: castId(t) }).catch(() => {});
  return { ok: true, via: c.label };
}

async function volume(c, t, v) { await call(c, 'cast_send', { target: target(t), do: 'volume', value: v }); return { ok: true, level: v, via: c.label }; }

module.exports = { pick, show, say, stop, volume };
