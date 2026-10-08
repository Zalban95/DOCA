'use strict';

/**
 * The language a person speaks to the hive, for the transcriber and for the answer (2026-10-08: a short question in a
 * call came back from whisper as Russian and was answered in Russian). Whisper guesses the language of each recording
 * by itself, and on a second or two of speech in a noisy room it guesses wrong — Russian most of all, the language of
 * the subtitled videos its silence phrases come from (stt-filter.js).
 *
 * Two answers: the screen's `call.language` when someone chose one (whisper is then told the language and does not
 * guess), else the person's usual language — the one most of their recent messages were written or spoken in
 * (lang-guess.js over their own conversations), which is not forced on whisper, since a person who speaks two languages
 * would have every other sentence turned into the first, but is used to check a short transcript that came back in
 * another one (stt.js) and to tell the agent what to answer in (turn/client.js).
 */
const lang = require('./lang-guess');

const KEEP_MS = 10 * 60000;
const ROWS = 30;           // the person's newest messages that are read
const _cache = new Map();  // userId → {at, value}

/** The text a person wrote or said in a row, or '' for anything else (an automatic report, a tool's result). */
const said = r => (r?.role === 'user' && typeof r.content === 'string' && !/^\s*\[/.test(r.content) ? r.content : '');

/** The person's usual language: {code, of, votes} from their newest messages, or null when too few say. */
function usual(userId) {
  if (!userId) return null;
  const hit = _cache.get(userId);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  let value = null;
  try {
    const memory = require('./harness/memory');
    const own = memory.listSessions().sessions.filter(s => s.person?.id === userId).slice(0, 8);
    const rows = own.flatMap(s => memory.messages(s.id).filter(said).slice(-ROWS))
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, ROWS);
    const votes = {};
    for (const r of rows) { const g = lang.guess(said(r)); if (g) votes[g] = (votes[g] || 0) + 1; }
    const [code, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || [];
    const all = Object.values(votes).reduce((a, b) => a + b, 0);
    // Three messages in it, and most of those that said anything: fewer is not a habit.
    if (code && n >= 3 && n / all > 0.5) value = { code, of: all, votes: n };
  } catch { /* no conversations to read: unknown */ }
  _cache.set(userId, { at: Date.now(), value });
  if (_cache.size > 200) _cache.delete(_cache.keys().next().value);
  return value;
}

/** A language the screen chose (`call.language`): a two-letter code, or null for "the person's usual". */
const chosen = call => (/^[a-z]{2}$/.test(String(call?.language || '').trim().toLowerCase()) ? call.language.trim().toLowerCase() : null);

/** For a transcription: `language` to tell the transcriber (chosen), `usual` to check a short one against. */
function pick(call, userId) {
  const set = chosen(call);
  if (set) return { language: set, usual: set, from: 'screen' };
  const u = usual(userId);
  return { language: null, usual: u?.code || null, from: u ? 'person' : null };
}

/** The screen a panel request comes from, and its person. */
function forRequest(req) {
  let call = {};
  try { call = require('./screens').forRequest(req).call || {}; } catch { /* the hive's */ }
  return pick(call, req?.auth?.user?.id || null);
}

/** A paired device (a watch's call through the hub's own voice): its screen settings, its person. */
function forDevice(deviceId) {
  try {
    const d = deviceId && require('./api-v1/devices').get(deviceId);
    if (!d) return pick({}, null);
    return pick(require('./screens').effective(d.id, d.userId).settings.call || {}, d.userId || null);
  } catch { return pick({}, null); }
}

/** A turn's client (turn/client.js): its screen's choice, else its person's usual language — a code, or null. */
function forClient(client) {
  const screen = client?.screen || (client?.kind !== 'dashboard' ? client?.id : null);
  const userId = client?.user?.id || null;
  let call = {};
  try { if (screen) call = require('./screens').effective(screen, userId).settings.call || {}; } catch { /* the hive's */ }
  return pick(call, userId).usual;
}

/** What a spoken turn is told about language (turn/client.js): answer in theirs; a lone transcript in another is a mishearing. */
function spokenLine(code) {
  const name = code ? lang.nameOf(code) : null;
  const theirs = name ? `They usually speak ${name}: answer in ${name}` : 'Answer in the language they usually speak to you';
  return `${theirs} unless they have clearly switched — they said so, or wrote or spoke two messages in a row in the other language. `
    + 'What they say reaches you through a transcriber, which on a short phrase in a noisy room can come back in a language they never spoke: '
    + `a single message in another language with none before it is most likely that — say briefly${name ? ` in ${name}` : ''} that you did not catch it and ask them to say it again; `
    + 'do not answer it in that language.';
}

/** For a test, or after a person's language was set by hand. */
const forget = userId => (userId ? _cache.delete(userId) : _cache.clear());

module.exports = { usual, pick, chosen, forRequest, forDevice, forClient, spokenLine, forget, said };
