'use strict';

/**
 * How the hive's messages look in Telegram (the events and their order are every channel's: ../deliver.js):
 * text in parts under Telegram's 4096 characters, pictures uploaded (the hub is not reachable from Telegram), a
 * question as inline buttons, and the question's message edited when it is answered elsewhere.
 */
const api = require('./api');
const links = require('./links');
const deliver = require('../deliver');

const MAX = 4000;   // Telegram's limit is 4096 characters a message
const split = text => deliver.split(text, MAX);

async function say(chatId, text, extra = {}) {
  let last = null;
  for (const part of split(text)) last = await api.call('sendMessage', { chat_id: chatId, text: part, ...extra });
  return last;
}

/** A picture the agent showed (show_media): uploaded, since the hub is not reachable from Telegram. */
async function picture(chatId, image) {
  const a = deliver.attachmentOf(image);
  if (!a) return;
  const [method, field] = a.kind === 'video' ? ['sendVideo', 'video'] : a.kind === 'audio' ? ['sendAudio', 'audio'] : a.kind === 'image' ? ['sendPhoto', 'photo'] : ['sendDocument', 'document'];
  await api.upload(method, { chat_id: chatId }, { field, name: a.name, buffer: a.buffer, mime: a.mime });
}

const channel = {
  say: (chatId, text) => say(chatId, text),
  typing: chatId => api.call('sendChatAction', { chat_id: chatId, action: 'typing' }),
  picture,
  async ask(chatId, q, text) {
    const buttons = deliver.choicesOf(q).map(c => [{ text: String(c.label || c.id).slice(0, 60), callback_data: `p|${q.id}|${c.id}`.slice(0, 64) }]);
    const m = await say(chatId, text, buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {});
    if (m) links.promptMessage(q.id, { chatId, messageId: m.message_id, text });
  },
  async closed(chatId, promptId, reason) {
    const where = links.promptMessage(promptId);
    if (where?.chatId === chatId)
      await api.call('editMessageText', { chat_id: chatId, message_id: where.messageId, text: `${where.text}\n\n(${reason})` }).catch(() => {});
  },
};

const onEvent = (chatId, deviceId, env) => deliver.onEvent(channel, chatId, deviceId, env);

module.exports = { onEvent, say, split };
