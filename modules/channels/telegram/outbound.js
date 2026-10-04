'use strict';

/**
 * What the hive says to a linked chat: the chat's device is subscribed to the bus like any client, and its
 * events become messages — the answer to a turn it asked for (with the pictures), a question as inline
 * buttons, the question closed where it was answered elsewhere, a notice (tell_device). Durable events are
 * acknowledged only once Telegram has taken the message, so a hub restart or a Telegram outage replays them.
 */
const api = require('./api');
const links = require('./links');

const MAX = 4000;   // Telegram's limit is 4096 characters a message
const split = text => { const out = []; let s = String(text || ''); while (s.length > MAX) { const cut = s.lastIndexOf('\n', MAX) > MAX / 2 ? s.lastIndexOf('\n', MAX) : MAX; out.push(s.slice(0, cut)); s = s.slice(cut).replace(/^\n/, ''); } if (s) out.push(s); return out; };

async function say(chatId, text, extra = {}) {
  let last = null;
  for (const part of split(text)) last = await api.call('sendMessage', { chat_id: chatId, text: part, ...extra });
  return last;
}

/** A picture the agent showed (show_media): uploaded, since the hub is not reachable from Telegram. */
async function picture(chatId, image) {
  const a = require('../../attachments').get(image.name);
  if (!a) return;
  const buffer = require('fs').readFileSync(a.path);
  const kind = image.kind || require('../../attachments').playableKind?.(a.mime) || 'image';
  const [method, field] = kind === 'video' ? ['sendVideo', 'video'] : kind === 'audio' ? ['sendAudio', 'audio'] : kind === 'image' ? ['sendPhoto', 'photo'] : ['sendDocument', 'document'];
  await api.upload(method, { chat_id: chatId }, { field, name: a.name, buffer, mime: a.mime });
}

const blockText = blocks => (Array.isArray(blocks) ? blocks : []).map(b => b?.text || b?.alt || '').filter(Boolean).join('\n');

async function onEvent(chatId, deviceId, env) {
  const p = env.payload || {};
  switch (env.type) {
    case 'agent.turn':
      if (p.by !== deviceId) return;   // the chat's own turns; the rest of the person's work stays in the panel
      if (p.state === 'started') return void api.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
      if (p.state === 'done') {
        if (p.text) await say(chatId, p.text);
        for (const img of p.images || []) await picture(chatId, img).catch(e => say(chatId, `(a picture could not be sent: ${e.message})`));
        if (p.proposals?.length) await say(chatId, `${p.proposals.length} settings change${p.proposals.length === 1 ? '' : 's'} waiting for you in the panel.`);
        return;
      }
      if (p.state === 'failed') return void await say(chatId, `⚠ ${p.error?.message || 'The turn failed.'}`);
      if (p.state === 'cancelled') return void await say(chatId, 'Stopped.');
      return;
    case 'prompt.new': {
      const q = p.prompt || {};
      const buttons = (q.choices || []).filter(c => c.type === 'option' || c.type === 'dismiss')
        .map(c => [{ text: String(c.label || c.id).slice(0, 60), callback_data: `p|${q.id}|${c.id}`.slice(0, 64) }]);
      const text = [q.title, blockText(q.body)].filter(Boolean).join('\n\n') || 'A question';
      const m = await say(chatId, text, buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {});
      if (m) links.promptMessage(q.id, { chatId, messageId: m.message_id, text });
      return;
    }
    case 'prompt.closed': {
      const where = links.promptMessage(p.promptId);
      if (where?.chatId === chatId)
        await api.call('editMessageText', { chat_id: chatId, message_id: where.messageId, text: `${where.text}\n\n(${p.reason === 'answered' ? 'answered elsewhere' : p.reason || 'closed'})` }).catch(() => {});
      return;
    }
    case 'alert':
      await say(chatId, [p.title, p.text || p.body].filter(Boolean).join('\n') || 'A notice');
      if (p.image?.name) await picture(chatId, p.image).catch(() => {});
      return;
    default:
  }
}

module.exports = { onEvent, say, split };
