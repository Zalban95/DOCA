'use strict';

/**
 * A question asked while a call is open is said and answered by voice (the owner, 2026-10-08: in a Live call the
 * approval waited behind the call screen, was never seen, and the turn gave up).
 *
 *   sentence(name, args)   one short sentence for the call's voice: "Shall I set ambient's place to Pesaro? Say yes or no."
 *   heard(text)            what a spoken reply means: { decision: 'once' | 'deny', lang } or null — anything that is not
 *                          plainly yes or no is passed on as a message, and the question stays open
 *   answer({id, text, person})  heard() applied to a waiting question through approval-answer.js (the same rules as a
 *                          click): { decision, reply } — `reply` is said back to confirm — or { decision: null }
 *
 * No "always" by voice: remembering a kind of call is a decision for the card, where it can be read.
 * One matcher for every call: the panel's (chat-call-ask.js posts what it heard) and a device's (realtime/call-asks.js).
 */

/** Plain yeses and noes, in the languages DOCA's people speak; a reply is matched whole, give or take a courtesy. */
const YES = {
  en: ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'go ahead', 'go on', 'do it', 'allow', 'allow it', 'approve', 'approved', 'fine', 'alright', 'all right', 'of course', 'please do', 'yes please', 'sounds good'],
  it: ['sì', 'si', 'certo', 'va bene', 'vabbè', 'ok va bene', 'procedi', 'vai', 'fallo', 'consenti', 'approva', 'd\'accordo', 'daccordo', 'sì grazie', 'sì certo', 'sì ok', 'ok sì', 'perfetto', 'certamente'],
  es: ['sí', 'claro', 'vale', 'adelante', 'hazlo'], fr: ['oui', 'd\'accord', 'vas-y', 'allez-y'], de: ['ja', 'klar', 'mach', 'mach das', 'in ordnung'],
};
const NO = {
  en: ['no', 'nope', 'nah', 'stop', 'don\'t', 'do not', 'don\'t do it', 'deny', 'denied', 'refuse', 'cancel', 'no thanks', 'no thank you', 'not now', 'never mind'],
  it: ['no', 'non', 'fermo', 'fermati', 'stop', 'non farlo', 'annulla', 'nega', 'no grazie', 'lascia stare', 'lascia perdere', 'non ora'],
  es: ['no', 'para', 'no lo hagas'], fr: ['non', 'arrête', 'non merci'], de: ['nein', 'stopp', 'halt', 'nicht'],
};
const POLITE = /\b(please|thanks|thank you|grazie|per favore|prego|then|allora|pure|dai)\b/g;
const REPLY = {
  en: { once: 'All right — going ahead.', deny: 'All right — I won\'t.' },
  it: { once: 'Va bene, procedo.', deny: 'D\'accordo, non lo faccio.' },
};

const norm = t => String(t || '').toLowerCase().normalize('NFC').replace(/[’`]/g, '\'').replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** One phrase ("go ahead", "sì grazie", "yes yes"): { decision, lang } or null. */
function phrase(said) {
  const bare = said.replace(POLITE, ' ').replace(/\s+/g, ' ').trim();
  const once = [...new Set((bare || said).split(' '))].join(' ');   // "sì sì": the same word again
  for (const [table, decision] of [[NO, 'deny'], [YES, 'once']]) {
    for (const [lang, words] of Object.entries(table)) if ([said, bare, once].some(w => w && words.includes(w))) return { decision, lang };
  }
  return null;
}

/** A reply of a phrase or a few ("No, stop." "Yes, go ahead."): every one a yes, or every one a no — else it is a message. */
function heard(text) {
  const parts = String(text || '').split(/[,.;:!?]+/).map(norm).filter(Boolean);
  if (!parts.length || parts.join(' ').split(' ').length > 6) return null;   // a sentence is a message, not an answer
  const courtesy = w => !w.replace(POLITE, ' ').trim();   // "sì, grazie": the thanks is no answer of its own
  const each = (parts.every(courtesy) ? parts : parts.filter(w => !courtesy(w))).map(phrase);
  if (each.some(h => !h) || new Set(each.map(h => h.decision)).size > 1) return null;
  return each[0];
}

/** "ambient.place" → "ambient's place"; "call.silenceMs" → "call silence ms". */
const named = path => {
  const words = String(path || '').split('.').map(w => w.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase());
  return words.length === 2 ? `${words[0]}'s ${words[1]}` : words.join(' ');
};
const short = (v, n = 60) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}…` : s; };

function sentence(name, args = {}) {
  args = args && typeof args === 'object' ? args : {};
  let q;
  if (name === 'settings_propose' && Array.isArray(args.changes) && args.changes.length) {
    const c = args.changes[0];
    q = `Shall I set ${named(c.path)} to ${short(c.value)}${args.changes.length > 1 ? `, and ${args.changes.length - 1} more` : ''}?`;
  } else if (name === 'shell') q = `Shall I run ${short(String(args.command || '').split(/\s+/).slice(0, 4).join(' '), 50)}?`;
  else if (name === 'api_call' || name === 'http_fetch') {
    let host = ''; try { host = new URL(String(args.url)).host; } catch { /* no address */ }
    q = `Shall I send a ${String(args.method || 'GET').toUpperCase()} request${host ? ` to ${host}` : ''}?`;
  } else if (name === 'service') q = `Shall I use ${String(args.service || 'the service')}${args.operation ? ` to ${String(args.operation).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase()}` : ''}?`;
  else if (name === 'write_file') q = `Shall I write ${String(args.path || 'a file').split(/[\\/]/).pop()}?`;
  else q = `Shall I use ${String(name).split('__').pop().replace(/_/g, ' ')}?`;
  return `${q} Say yes or no.`;
}

/** A spoken reply to a waiting question, decided as a click would be. */
function answer({ id, text, person }) {
  const h = heard(text);
  if (!h) return { decision: null };
  const ok = require('./approval-answer').answerAs({ id, decision: h.decision, person });
  if (!ok) return { decision: null, gone: true };
  return { decision: h.decision, reply: (REPLY[h.lang] || REPLY.en)[h.decision] };
}

module.exports = { heard, sentence, answer, named };
