'use strict';

/**
 * Where a hive-chat message reaches a person beyond the panel — their own choice, nobody else's (asked 2026-10-10: a
 * message came through on the owner's Telegram, "nice", now a setting). One document per person
 * (`people-notify/<user id>`):
 *
 *   devices   the phone, watch and desk client: `all` (every message in a space they are in) | `mentions` (direct
 *             messages and messages naming them — the default) | `off`
 *   chats     their linked chats (Telegram, Matrix, Slack, mail — channels/, a device of kind `channel`): the same three
 *   each      per device, over those: `{when?: all|mentions|off, content?: full|notice}` — `notice` sends "New message
 *             from Ada in #ops" without the words, for a personal chat that should only say something came through
 *
 * Whatever is chosen, a muted space never notifies, a person is never notified of their own message (or of their own
 * agent answering them), and a device in its quiet hours is left alone — read on the person's own clock when the hub
 * knows it (timezones.js), else the hub's, as prompts.inQuietHours always did.
 */
const store = require('../store');

const WHEN = ['all', 'mentions', 'off'];
const CONTENT = ['full', 'notice'];
const DEFAULTS = Object.freeze({ devices: 'mentions', chats: 'mentions' });
const doc = userId => `people-notify/${userId}`;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** The person's devices this setting is about: paired to them, not revoked, able to show a notice (reach-shows.js). */
function ownDevices(userId) {
  const shows = require('../harness/reach-shows').shows;
  return require('../api-v1/devices').list().filter(d => !d.revokedAt && d.userId === userId && d.kind !== 'browser' && shows(d));
}

function get(userId) {
  const saved = (userId && store.readJson(doc(userId), null)) || {};
  return { devices: WHEN.includes(saved.devices) ? saved.devices : DEFAULTS.devices,
    chats: WHEN.includes(saved.chats) ? saved.chats : DEFAULTS.chats, each: saved.each && typeof saved.each === 'object' ? saved.each : {} };
}

/** Change it: only the three words, and only for the person's own devices. Returns what is now in effect. */
function set(userId, patch = {}) {
  if (!userId) throw bad('Sign in first.', 401);
  const cur = get(userId);
  for (const k of ['devices', 'chats']) if (patch[k] !== undefined) {
    if (!WHEN.includes(patch[k])) throw bad(`"${k}" is one of ${WHEN.join(', ')}.`);
    cur[k] = patch[k];
  }
  if (patch.each !== undefined) {
    if (!patch.each || typeof patch.each !== 'object') throw bad('"each" maps a device id to {when, content}.');
    const mine = new Set(ownDevices(userId).map(d => d.id));
    for (const [id, rule] of Object.entries(patch.each)) {
      if (!mine.has(id)) throw bad(`"${id}" is not a device of yours that shows notices.`, 404);
      if (rule === null) { delete cur.each[id]; continue; }
      const r = {};
      if (rule.when != null && rule.when !== '') { if (!WHEN.includes(rule.when)) throw bad(`"when" is one of ${WHEN.join(', ')}, or empty for the default.`); r.when = rule.when; }
      if (rule.content != null) { if (!CONTENT.includes(rule.content)) throw bad(`"content" is one of ${CONTENT.join(', ')}.`); if (rule.content !== 'full') r.content = rule.content; }
      if (Object.keys(r).length) cur.each[id] = r; else delete cur.each[id];
    }
  }
  store.writeJson(doc(userId), { ...cur, updatedAt: new Date().toISOString() });
  return view(userId);
}

/** What a device gets: its own rule, else the default for its kind. */
function ruleFor(userId, d, s = get(userId)) {
  const own = s.each[d.id] || {};
  return { when: own.when || (d.kind === 'channel' ? s.chats : s.devices), content: own.content || 'full', own: !!own.when };
}

/** Whether a message of `level` (`direct`: a DM or a mention; `other`: anything else) reaches a device with `rule`. */
const wants = (rule, level) => !!level && (rule.when === 'all' || (rule.when === 'mentions' && level === 'direct'));

/** The device's quiet hours, on the person's own clock when known. */
function quiet(d, now = new Date()) {
  let prof;
  try { prof = require('../api-v1/profiles').get(d.id); } catch { return false; }
  const q = prof?.quietHours;
  if (!q?.from || !q?.to) return false;
  const tz = require('../timezones').of(d.userId);
  if (!tz) return require('../api-v1/prompts').inQuietHours(prof, now);
  const wall = require('../timezones').toWall(now, tz);
  const [fh, fm] = q.from.split(':').map(Number), [th, tm] = q.to.split(':').map(Number);
  const cur = wall.getUTCHours() * 60 + wall.getUTCMinutes(), from = fh * 60 + fm, to = th * 60 + tm;
  return from <= to ? (cur >= from && cur < to) : (cur >= from || cur < to);
}

/** The setting with the person's devices listed, for the panel and a device. */
function view(userId) {
  const s = get(userId);
  const devices = ownDevices(userId).map(d => {
    const r = ruleFor(userId, d, s);
    let quietHours = null;
    try { quietHours = require('../api-v1/profiles').get(d.id)?.quietHours || null; } catch { /* none */ }
    return { id: d.id, name: d.name, kind: d.kind === 'channel' ? 'chat' : (d.caps?.formFactor || 'device'), channel: d.caps?.ext?.channel || null,
      when: s.each[d.id]?.when || '', content: r.content, effective: r.when, quietHours };
  });
  return { devices: s.devices, chats: s.chats, list: devices, choices: { when: WHEN, content: CONTENT } };
}

module.exports = { get, set, view, ruleFor, wants, quiet, ownDevices, WHEN, CONTENT, DEFAULTS };
