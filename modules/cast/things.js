'use strict';

/**
 * Casting to things Nearby saved (docs/design/cast-reach.md, phase A; asked 2026-10-12, "we should be able to cast on
 * the nearby devices we have saved with the cast button"): a Cast TV or speaker this hub reaches on its own network.
 *   list(who)                 the saved things that take Cast, by place and room, that this person may use — an admin
 *                             every one, anyone else what is allotted (`nearby`: its id or `place:<place>`, auth/allot.js)
 *   show(who, id, page)       a TV shows the page: a one-time view link opened by DashCast (`force`) through the door
 *   say(who, id, text)        a speaker (or a TV) says it in the person's Quick call voice, through the Default Media Receiver
 *   stop / volume             the receiver's own
 * Each act is a line in the activity log with the thing as its machine (machines/acts.js's words). The connection is
 * opened for the act and closed after; the receiver keeps playing or showing by itself.
 */
const { connect, APPS, NS } = require('./castv2/sender');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const personOf = who => ({ id: who?.user?.id || null, role: who?.role || null });
const name = t => t.name || t.how?.cast?.name || t.id;

/** May this person use this thing: by its id, or by its place. */
function mayUse(who, t) {
  const allot = require('../auth/allot'), p = personOf(who);
  return allot.uses(p, 'nearby', t.id) || (!!t.place && allot.uses(p, 'nearby', `place:${t.place}`));
}

const castable = t => (t.can || []).includes('cast') && t.how?.cast?.ip;

function list(who) {
  return require('../nearby/store').saved().filter(t => castable(t) && mayUse(who, t)).map(t => ({
    id: t.id, name: name(t), kind: t.kind || 'thing', place: t.place || null, room: t.room || null, model: t.model || null,
    shows: t.kind !== 'speaker', speaks: true, address: t.how.cast.ip, lastSeen: t.lastSeen || null }))
    .sort((a, b) => String(a.place || '~').localeCompare(String(b.place || '~')) || String(a.room || '~').localeCompare(String(b.room || '~')) || a.name.localeCompare(b.name));
}

function thing(who, id) {
  const t = require('../nearby/store').saved().find(x => x.id === id);
  if (!t || !castable(t)) throw bad('Not a saved Cast device of this hive.', 404);
  if (!mayUse(who, t)) throw bad('Not a device allotted to you: an admin allots it (Settings → Users).', 403);
  return t;
}

function note(who, t, what, act) {
  require('../activity').note({ from: 'cast', what, why: 'a person cast it', person: { id: who.user.id, name: who.user.name || who.user.email },
    machine: { kind: 'nearby', id: t.id, name: name(t) }, act });
}

/** Run `fn(session)` on the device, then close. */
async function withDevice(t, fn) {
  const s = await connect({ host: t.how.cast.ip, port: Number(t.how.cast.port) || 8009 });
  try { return await fn(s); } finally { s.close(); }
}

/** The hub reaches it itself (an address on its network), else one of the person's devices that saw it there (relay.js). */
const via = (who, t) => (require('./door').addressFor(t.how.cast.ip) ? null : require('./relay').pick(who, t));

async function show(who, id, page) {
  const t = thing(who, id);
  if (!require('./views').VIEWS[page]) throw bad(`A screen can be given ${Object.keys(require('./views').VIEWS).join(', ')}.`);
  const link = require('./links').create({ page, name: `${name(t)} — ${require('./views').VIEWS[page].label}`, thing: t.id }, who);
  const c = via(who, t);
  if (c) { const r = await require('./relay').show(c, t, link); note(who, t, `cast ${page} to ${name(t)} through ${c.label}`, 'cast'); return { ...r, page }; }
  const origin = await require('./door').open(t.how.cast.ip, { page });
  const url = `${origin}${link.path}`;
  await withDevice(t, async s => {
    const app = await s.launch(APPS.dashcast);
    s.send(app.transportId, NS.dashcast, { url, force: true, reload: false, reload_time: 0 });
  });
  note(who, t, `cast ${page} to ${name(t)}`, 'cast');
  return { ok: true, url, page };
}

/** Say a sentence — or, with `story`, a longer text whose parts each carry their own tone (speech.js story). */
async function say(who, id, text, { story = false } = {}) {
  const t = thing(who, id);
  const words = String(text || '').trim().slice(0, story ? 4000 : 600);
  if (!words) throw bad('Say what?');
  const speech = require('./speech');
  const audio = story ? await speech.story(words, personOf(who)) : await speech.speak(words, personOf(who));
  const c = via(who, t);
  if (c) { const r = await require('./relay').say(c, t, audio, words.slice(0, 80)); note(who, t, `said a sentence on ${name(t)} through ${c.label}`, 'say'); return r; }
  const media = require('./media');
  const tok = media.token({ buffer: audio.buffer, mime: audio.mime, for: t.how.cast.ip });
  const origin = await require('./door').open(t.how.cast.ip, { tokens: [tok] });
  const r = await withDevice(t, async s => {
    const app = await s.launch(APPS.media);
    return s.request(app.transportId, NS.media, { type: 'LOAD', autoplay: true,
      media: { contentId: `${origin}/api/cast/media/${tok}`, contentType: audio.mime, streamType: 'BUFFERED', metadata: { metadataType: 0, title: words.slice(0, 80) } } }, 20000);
  });
  if (r.data?.type === 'LOAD_FAILED' || r.data?.type === 'LOAD_CANCELLED') throw bad(`${name(t)} could not play it (${r.data.type}).`, 502);
  note(who, t, `said a sentence on ${name(t)}`, 'say');
  return { ok: true };
}

async function stop(who, id) {
  const t = thing(who, id);
  const c = via(who, t);
  if (c) { await require('./relay').stop(c, t); require('./links').forgetThing(t.id); note(who, t, `stopped what played on ${name(t)} through ${c.label}`, 'stop'); return { ok: true }; }
  await withDevice(t, async s => {
    const apps = (await s.status()).applications || [];
    for (const a of apps.filter(x => x.appId === APPS.dashcast || x.appId === APPS.media)) await s.stop(a.sessionId);
  });
  require('./door').release(t.how.cast.ip);
  require('./links').forgetThing(t.id);   // the page it showed is signed out with it
  note(who, t, `stopped what played on ${name(t)}`, 'stop');
  return { ok: true };
}

async function volume(who, id, level) {
  const t = thing(who, id);
  const v = Math.max(0, Math.min(1, Number(level)));
  if (!Number.isFinite(v)) throw bad('A volume from 0 to 1.');
  const c = via(who, t);
  if (c) return require('./relay').volume(c, t, v);
  await withDevice(t, s => s.volume(v));
  return { ok: true, level: v };
}

module.exports = { list, show, say, stop, volume, mayUse };
