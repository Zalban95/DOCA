'use strict';

/**
 * How the hive's messages look in Matrix (the events and their order are every channel's: ../deliver.js): plain
 * text, pictures and files uploaded to the homeserver's media repository, and a question as a numbered list —
 * Matrix has no buttons every client draws — answered by replying with the number. The open question is kept on
 * the room's link, so the next number written there answers it; one answered elsewhere is closed with a line.
 */
const crypto = require('crypto');
const api = require('./api');
const deliver = require('../deliver');

const MAX = 8000;   // an event may be 64 KiB; long answers read better in parts
const links = () => require('./index').links;

async function say(room, text) {
  for (const part of deliver.split(text, MAX)) await api.send(room, { msgtype: 'm.text', body: part });
}

/** A file — a picture shown, or one sent (tell_device) — in the media repository; the caption is the body (spec v1.10). */
async function file(room, f) {
  const url = await api.upload(f.buffer, f.name, f.mime);
  const msgtype = { image: 'm.image', video: 'm.video', audio: 'm.audio' }[f.kind] || 'm.file';
  await api.send(room, { msgtype, body: f.caption || f.name, ...(f.caption ? { filename: f.name } : {}), url, info: { mimetype: f.mime, size: f.buffer.length } });
}

const channel = {
  say,
  typing: room => (require('./index').me() ? api.typing(room, require('./index').me()) : null),
  file,
  async ask(room, q, text) {
    const choices = deliver.choicesOf(q).map(c => ({ id: c.id, label: String(c.label || c.id) }));
    if (!choices.length) return void await say(room, text);
    await say(room, `${text}\n\n${choices.map((c, i) => `${i + 1}. ${c.label}`).join('\n')}\n\nReply with the number.`);
    links().saveChat(room, { prompt: { id: q.id, choices } });
  },
  async closed(room, promptId, reason) {
    if (links().chat(room)?.prompt?.id !== promptId) return;
    links().saveChat(room, { prompt: null });
    await say(room, `(the question was ${reason})`);
  },
};

/** A number written while a question is open answers it (converse.js asks before treating it as a message). */
async function answer(room, text, device) {
  const q = links().chat(room)?.prompt;
  const n = Number((/^\s*(\d{1,2})\s*\.?\s*$/.exec(text) || [])[1]);
  if (!q || !n || !q.choices[n - 1]) return false;
  links().saveChat(room, { prompt: null });
  try {
    await require('../../api-v1/prompts').select(q.id, device, { selectionId: crypto.randomUUID(), choiceId: q.choices[n - 1].id });
    await say(room, `→ ${q.choices[n - 1].label}`);
  } catch (e) { await say(room, e.status === 409 ? 'That question was already answered or closed.' : `⚠ ${e.message}`); }
  return true;
}

const onEvent = (room, deviceId, env) => deliver.onEvent(channel, room, deviceId, env);

module.exports = { onEvent, say, answer };
