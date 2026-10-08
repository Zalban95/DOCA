'use strict';

/**
 * How the hive's messages look by mail (the events and their order are every channel's: ../deliver.js): a plain-text
 * reply in the thread the person last wrote in, a question as a numbered list answered by replying with the number
 * (the open question lives on the address's link, as in Matrix), and pictures and files attached to the reply.
 */
const crypto = require('crypto');
const deliver = require('../deliver');

const links = () => require('./index').links;
const prefsOf = () => require('../../utils').loadPrefs().channels?.mail || {};

async function say(addr, text, { subject, inReplyTo, files } = {}) {
  const p = prefsOf(), c = links().chat(addr) || {};
  const from = p.address || p.user;
  const raw = require('./mime').reply({ from, to: addr, subject: subject || c.lastSubject || 'DOCA', inReplyTo: inReplyTo || c.lastMessageId, text, files,
    domain: String(from || '').split('@')[1] || 'doca.local' });
  await require('./smtp').send(require('./index').server('smtp'), { from, to: addr, raw });
}

const channel = {
  say: (addr, t) => say(addr, t),
  // A file in a mail of its own (a picture with an answer); a notice's text and files go as one mail.
  file: (addr, f) => say(addr, f.caption || f.name, { files: [f] }),
  notice: (addr, text, files) => say(addr, [text, ...files.filter(f => f.caption).map(f => `${f.name}: ${f.caption}`)].join('\n\n'), { files }),
  async ask(addr, q, text) {
    const choices = deliver.choicesOf(q).map(c => ({ id: c.id, label: String(c.label || c.id) }));
    if (!choices.length) return void await say(addr, text);
    await say(addr, `${text}\n\n${choices.map((c, i) => `${i + 1}. ${c.label}`).join('\n')}\n\nReply with the number.`);
    links().saveChat(addr, { prompt: { id: q.id, choices } });
  },
  async closed(addr, promptId, reason) {
    if (links().chat(addr)?.prompt?.id !== promptId) return;
    links().saveChat(addr, { prompt: null });
    await say(addr, `(The question was ${reason}.)`);
  },
};

/** A reply that is just a number answers the open question (converse.js asks before treating it as a message). */
async function answer(addr, text, device) {
  const q = links().chat(addr)?.prompt;
  const n = Number((/^\s*(\d{1,2})\s*\.?\s*$/.exec(String(text).split('\n')[0]) || [])[1]);
  if (!q || !n || !q.choices[n - 1]) return false;
  links().saveChat(addr, { prompt: null });
  try {
    await require('../../api-v1/prompts').select(q.id, device, { selectionId: crypto.randomUUID(), choiceId: q.choices[n - 1].id });
    await say(addr, `→ ${q.choices[n - 1].label}`);
  } catch (e) { await say(addr, e.status === 409 ? 'That question was already answered or closed.' : `⚠ ${e.message}`); }
  return true;
}

const onEvent = (addr, deviceId, env) => deliver.onEvent(channel, addr, deviceId, env);

module.exports = { onEvent, say, answer };
