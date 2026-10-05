'use strict';

/**
 * What a chat sends the hive. A linked private chat's message is a turn in its conversation, through the
 * same adapter a phone's message goes through (api-v1/harness post), as the chat's device — so the charter,
 * the person's level, approvals and the queue for a working conversation are the ones every client gets.
 * A voice note is transcribed by the panel's STT and answered as speech would be; a photo or a file is an
 * attachment (the commands and the turn are every channel's: ../converse.js). A button press answers the question
 * it was asked with. Anything else gets instructions.
 */
const crypto = require('crypto');
const api = require('./api');
const links = require('./links');
const { say } = require('./outbound');
const { handle, keepFile, howto } = require('../converse');

const HOWTO = howto('Telegram');

async function onCallback(cq, adapter) {
  const [kind, promptId, choiceId] = String(cq.data || '').split('|');
  const c = links.chat(cq.message?.chat?.id);
  const answer = text => api.call('answerCallbackQuery', { callback_query_id: cq.id, text }).catch(() => {});
  if (kind !== 'p' || !c) return answer('This chat is not linked.');
  try {
    await require('../../api-v1/prompts').select(promptId, require('../../api-v1/devices').get(c.deviceId),
      { selectionId: crypto.randomUUID(), choiceId });
    await answer('Sent.');
    const label = (cq.message.reply_markup?.inline_keyboard || []).flat().find(b => b.callback_data === cq.data)?.text || choiceId;
    await api.call('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: `${cq.message.text}\n\n→ ${label}` }).catch(() => {});
  } catch (e) { await answer(e.status === 409 ? 'Already answered or closed.' : e.message.slice(0, 180)); }
  void adapter;
}

/** A file the chat sent, saved as an attachment; for speech, the transcript too. */
async function keep(m, chatDevice) {
  const f = m.voice || m.audio || m.video_note || m.video || m.document || (m.photo && m.photo[m.photo.length - 1]);
  if (!f) return null;
  const { buffer, path: tgPath } = await api.download(f.file_id);
  const name = f.file_name || require('path').basename(tgPath) || `telegram-${f.file_unique_id}`;
  const mime = f.mime_type || (m.photo ? 'image/jpeg' : m.voice ? 'audio/ogg' : undefined);
  return keepFile({ buffer, name, mime, speech: !!(m.voice || m.audio || m.video_note) }, chatDevice);
}

async function onMessage(m, adapter) {
  const chatId = m.chat?.id;
  if (!chatId || m.from?.is_bot) return;
  if (m.chat.type !== 'private') return void await say(chatId, 'I answer in a private chat only.');
  const who = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username || String(chatId);
  await handle({ label: 'Telegram', links, bind: adapter.bind, say: (id, t) => say(Number(id), t) },
    { addr: String(chatId), text: m.text || m.caption || '', from: { who, username: m.chat.username }, keep: deviceId => keep(m, deviceId) });
}

module.exports = { onMessage, onCallback, HOWTO };
