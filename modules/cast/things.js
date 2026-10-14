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

const hasCast = t => (t.can || []).includes('cast') && !!t.how?.cast?.ip;
// A DLNA renderer (R3e, cast/dlna.js): plays sound and video, shows no page. Its address: the sighting's, else its control URL's.
const dlnaOnly = t => !hasCast(t) && (t.can || []).includes('dlna-play') && !!t.how?.dlna?.control;
const castable = t => hasCast(t) || dlnaOnly(t);
const ipOf = t => t.how?.cast?.ip || t.how?.dlna?.ip || (() => { try { return new URL(t.how.dlna.control).hostname; } catch { return null; } })();

/** The port that answers for it: Cast's, else its DLNA control's. */
const portOf = t => (hasCast(t) ? Number(t.how.cast.port) || 8009 : (() => { try { const u = new URL(t.how.dlna.control); return Number(u.port) || 80; } catch { return null; } })());

const SEEN_MS = 24 * 3600e3;

/**
 * What may be cast to: the things Nearby saved, and — so a TV on a network the person just walked into needs no saving
 * first (the owner, 2026-10-13, R3j) — the castable things seen in the last day and not saved, marked `seenOnly`.
 */
function pool() {
  const store = require('../nearby/store');
  const saved = store.saved();
  const savedSeen = new Set(saved.map(t => t.seenId).filter(Boolean));
  const seen = store.seen().filter(t => !savedSeen.has(t.id) && t.lastSeen && Date.now() - Date.parse(t.lastSeen) < SEEN_MS).map(t => ({ ...t, seenOnly: true }));
  // A saved thing that says it casts but kept no Cast address still has its address: Cast's own port there.
  const mended = t => ((t.can || []).includes('cast') && !t.how?.cast?.ip && t.addresses?.[0]
    ? { ...t, how: { ...(t.how || {}), cast: { name: t.name, ip: t.addresses[0], port: 8009 } } } : t);
  return [...saved, ...seen].map(mended);
}

/**
 * What may be cast to, for the Cast sheet. `now` ({by: network id}, lookers.whereNow) says where the person's lookers are,
 * so each thing carries the named network it was seen on and whether any of them is there now (`here`; null: unknown).
 */
function list(who, now = null) {
  const nets = require('../nearby/networks');
  const present = new Set(Object.values(now || {}).filter(Boolean));
  const netOf = t => { const id = t.network || (t.seenFrom || []).find(x => x.net)?.net || null; const n = id ? nets.get(id) : null; return n ? { id: n.id, label: n.label } : null; };
  return pool().filter(t => castable(t) && mayUse(who, t)).map(t => ({
    ...(n => (n ? { network: n, here: now ? present.has(n.id) : null } : {}))(netOf(t)),
    id: t.id, name: name(t), kind: t.kind || 'thing', place: t.place || null, room: t.room || null, model: t.model || null,
    shows: t.kind !== 'speaker' && hasCast(t), speaks: true, address: ipOf(t), port: portOf(t), via: hasCast(t) ? 'cast' : 'dlna', lastSeen: t.lastSeen || null,
    ...(t.seenOnly ? { seenOnly: true, seenFrom: (t.seenFrom || [])[0]?.label || null } : {}) }))
    .sort((a, b) => Number(!!a.seenOnly) - Number(!!b.seenOnly) || String(a.place || '~').localeCompare(String(b.place || '~')) || String(a.room || '~').localeCompare(String(b.room || '~')) || a.name.localeCompare(b.name));
}

function thing(who, id) {
  const t = pool().find(x => x.id === id);
  if (!t || !castable(t)) throw bad('Not a Cast or DLNA device saved or seen in the last day.', 404);
  if (!mayUse(who, t)) throw bad('Not a device allotted to you: an admin allots it (Settings → Users).', 403);
  return t;
}

/** " on Rossi's office": the named network a thing was seen on, for the activity line of a cast through a device. */
const onNet = t => { const id = t.network || (t.seenFrom || []).find(x => x.net)?.net; const n = id ? require('../nearby/networks').get(id) : null; return n ? ` on ${n.label}` : ''; };

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
const via = (who, t) => (dlnaOnly(t) || require('./door').addressFor(ipOf(t)) ? null : require('./relay').pick(who, t));

async function show(who, id, page) {
  const t = thing(who, id);
  if (!require('./views').VIEWS[page]) throw bad(`A screen can be given ${Object.keys(require('./views').VIEWS).join(', ')}.`);
  if (dlnaOnly(t)) throw bad(`${name(t)} plays over DLNA, which has no browser: it can say a sentence or play a sound, not show a page.`, 409);
  const link = require('./links').create({ page, name: `${name(t)} — ${require('./views').VIEWS[page].label}`, thing: t.id }, who);
  const c = via(who, t);
  if (c) { const r = await require('./relay').show(c, t, link); require('./running').note({ thing: t.id, ip: ipOf(t), page, via: c.id }); note(who, t, `cast ${page} to ${name(t)} through ${c.label}${onNet(t)}`, 'cast'); return { ...r, page }; }
  const origin = await require('./door').open(t.how.cast.ip, { page });
  const url = `${origin}${link.path}`;
  await withDevice(t, async s => {
    const app = await s.launch(APPS.dashcast);
    s.send(app.transportId, NS.dashcast, { url, force: true, reload: false, reload_time: 0 });
  });
  require('./running').note({ thing: t.id, ip: ipOf(t), page });   // kept across a restart (running.js)
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
  if (c) { const r = await require('./relay').say(c, t, audio, words.slice(0, 80)); note(who, t, `said a sentence on ${name(t)} through ${c.label}${onNet(t)}`, 'say'); return r; }
  const media = require('./media');
  const tok = media.token({ buffer: audio.buffer, mime: audio.mime, for: ipOf(t) });
  const origin = await require('./door').open(ipOf(t), { tokens: [tok] });
  if (dlnaOnly(t)) {
    await require('./dlna').play(t.how.dlna, `${origin}/api/cast/media/${tok}`, audio.mime, words.slice(0, 80));
    note(who, t, `said a sentence on ${name(t)} (DLNA)`, 'say');
    return { ok: true };
  }
  const r = await withDevice(t, async s => {
    const app = await s.launch(APPS.media);
    return s.request(app.transportId, NS.media, { type: 'LOAD', autoplay: true,
      media: { contentId: `${origin}/api/cast/media/${tok}`, contentType: audio.mime, streamType: 'BUFFERED', metadata: { metadataType: 0, title: words.slice(0, 80) } } }, 20000);
  });
  if (r.data?.type === 'LOAD_FAILED' || r.data?.type === 'LOAD_CANCELLED') throw bad(`${name(t)} could not play it (${r.data.type}).`, 502);
  note(who, t, `said a sentence on ${name(t)}`, 'say');
  return { ok: true };
}

/**
 * Play a kept file — a video, a sound, a picture — on a TV or a speaker (asked 2026-10-14: "what happens if I ask the
 * agent to cast that video on the TV?"; until now only a page or a spoken sentence went). The file is an attachment (what
 * show_media or `computer get` kept), served once through the cast door to that device alone, with ranges so it seeks;
 * Cast plays it in its own media player, DLNA through its renderer. Through a phone it travels with the cast, so up to
 * RELAY_MAX. Attachments are the hive's files: a host's to send for now.
 */
const RELAY_MAX = 25 * 1024 * 1024;
async function play(who, id, file) {
  const t = thing(who, id);
  const att = require('../attachments');
  const a = att.get(String(file || '').split('/').pop());
  if (!a) throw bad(`No kept file "${file}": what show_media showed or \`computer get\` brought back is one (its name).`, 404);
  if (!require('../auth/rights').can(who?.role, 'host')) throw bad('Playing a kept file on a TV is an admin\'s for now: the attachments are the hive\'s files.', 403);
  const kind = att.playableKind(a.mime);
  if (!['video', 'audio', 'image'].includes(kind)) throw bad(`${a.name} is not a video, a sound or a picture (${a.mime}).`);
  if (kind !== 'audio' && t.kind === 'speaker') throw bad(`${name(t)} is a speaker: it plays a sound, not ${kind === 'video' ? 'a video' : 'a picture'}.`);
  const c = via(who, t);
  if (c) {
    if (a.bytes > RELAY_MAX) throw bad(`${name(t)} is reached through ${c.label}, which carries a file up to ${RELAY_MAX / 1048576} MB; ${a.name} is ${att.humanBytes(a.bytes)}.`, 413);
    const r = await require('./relay').say(c, t, { buffer: require('fs').readFileSync(a.path), mime: a.mime }, a.name);
    note(who, t, `played ${a.name} on ${name(t)} through ${c.label}${onNet(t)}`, 'play');
    return { ...r, file: a.name };
  }
  const media = require('./media');
  const tok = media.token({ file: a.path, mime: a.mime, for: ipOf(t) });
  const origin = await require('./door').open(ipOf(t), { tokens: [tok] });
  const url = `${origin}/api/cast/media/${tok}`;
  if (dlnaOnly(t)) {
    await require('./dlna').play(t.how.dlna, url, a.mime, a.name);
    note(who, t, `played ${a.name} on ${name(t)} (DLNA)`, 'play');
    return { ok: true, file: a.name };
  }
  const r = await withDevice(t, async s => {
    const app = await s.launch(APPS.media);
    return s.request(app.transportId, NS.media, { type: 'LOAD', autoplay: true,
      media: { contentId: url, contentType: a.mime, streamType: 'BUFFERED', metadata: { metadataType: 0, title: a.name } } }, 20000);
  });
  if (r.data?.type === 'LOAD_FAILED' || r.data?.type === 'LOAD_CANCELLED') throw bad(`${name(t)} could not play ${a.name} (${r.data.type}).`, 502);
  note(who, t, `played ${a.name} on ${name(t)}`, 'play');
  return { ok: true, file: a.name };
}

async function stop(who, id) {
  const t = thing(who, id);
  require('./running').forget(t.id);
  const c = via(who, t);
  if (c) { await require('./relay').stop(c, t); require('./links').forgetThing(t.id); note(who, t, `stopped what played on ${name(t)} through ${c.label}`, 'stop'); return { ok: true }; }
  if (dlnaOnly(t)) { await require('./dlna').stop(t.how.dlna); require('./door').release(ipOf(t)); note(who, t, `stopped what played on ${name(t)} (DLNA)`, 'stop'); return { ok: true }; }
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
  if (dlnaOnly(t)) { await require('./dlna').volume(t.how.dlna, v); return { ok: true, level: v }; }
  await withDevice(t, s => s.volume(v));
  return { ok: true, level: v };
}

module.exports = { list, show, say, play, stop, volume, mayUse, thing };
