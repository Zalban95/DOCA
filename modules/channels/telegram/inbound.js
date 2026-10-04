'use strict';

/**
 * What a chat sends the hive. A linked private chat's message is a turn in its conversation, through the
 * same adapter a phone's message goes through (api-v1/harness post), as the chat's device — so the charter,
 * the person's level, approvals and the queue for a working conversation are the ones every client gets.
 * A voice note is transcribed by the panel's STT and answered as speech would be; a photo or a file is an
 * attachment. A button press answers the question it was asked with. Anything else gets instructions.
 */
const crypto = require('crypto');
const api = require('./api');
const links = require('./links');
const { say } = require('./outbound');

const HOWTO = 'This is a DOCA hive. To talk to it here, open DOCA → Settings → Channels → "Link a Telegram chat" and send the code it gives you (or open its link).';

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

/** A file the chat sent, saved as an attachment; returns its name, and for speech the transcript. */
async function keep(m, chatDevice) {
  const attachments = require('../../attachments');
  const f = m.voice || m.audio || m.video_note || m.video || m.document || (m.photo && m.photo[m.photo.length - 1]);
  if (!f) return null;
  const { buffer, path: tgPath } = await api.download(f.file_id);
  const name = f.file_name || require('path').basename(tgPath) || `telegram-${f.file_unique_id}`;
  const mime = f.mime_type || (m.photo ? 'image/jpeg' : m.voice ? 'audio/ogg' : undefined);
  const a = attachments.save(buffer, name, { from: chatDevice, mime });
  let transcript = null;
  if (m.voice || m.audio || m.video_note) {
    try { transcript = await require('../../chat').transcribeAudio(buffer, mime || 'audio/ogg', name); }
    catch (e) { transcript = null; a.sttError = e.message; }
  }
  return { name: a.name, transcript, sttError: a.sttError };
}

async function onMessage(m, adapter) {
  const chatId = m.chat?.id;
  if (!chatId || m.from?.is_bot) return;
  if (m.chat.type !== 'private') return void await say(chatId, 'I answer in a private chat only.');
  const text = String(m.text || m.caption || '').trim();
  const code = (/^\/(?:start|link)\s+(\S+)/.exec(text) || [])[1];
  let c = links.chat(chatId);
  if (code) {
    const hit = links.redeem(code);
    if (!hit) return void await say(chatId, 'That code is unknown or has expired. Make a new one in DOCA → Settings → Channels.');
    c = await adapter.link(m.chat, hit.userId);
    return void await say(chatId, `Linked to ${c.personName}. Write here to talk to DOCA — voice notes, photos and files too. /new starts a fresh conversation, /stop stops the one running.`);
  }
  if (!c) return void await say(chatId, HOWTO);
  const devices = require('../../api-v1/devices');
  const device = devices.get(c.deviceId);
  if (!device || device.revokedAt) return void await say(chatId, 'This chat was unlinked in DOCA. Link it again from Settings → Channels.');
  const harness = require('../../api-v1/harness');
  if (/^\/start\b/.test(text)) return void await say(chatId, `Linked to ${c.personName}. Write here to talk to DOCA.`);
  if (/^\/new\b/.test(text)) {
    const s = harness.createSession('Telegram', { activate: false, device });
    links.saveChat(chatId, { sessionId: s.id });
    return void await say(chatId, 'A fresh conversation. Write away.');
  }
  if (/^\/stop\b/.test(text)) {
    try { harness.cancel(c.sessionId, device); return void await say(chatId, 'Stopping at the next step.'); }
    catch { return void await say(chatId, 'Nothing is running.'); }
  }
  let kept = null;
  try { kept = await keep(m, device.id); } catch (e) { await say(chatId, `(the file could not be fetched: ${e.message})`); }
  let message = text;
  if (kept?.transcript) {
    message = `${kept.transcript}\n\n[Sent as a Telegram voice note; the text above is its transcript, and the recording is attached. `
      + 'Answer as if speaking: a few sentences, no lists, no code — unless the message asks for something else.]';
  } else if (kept && !message) {
    message = kept.sttError ? `(a voice note — it could not be transcribed: ${kept.sttError})` : '(sent a file)';
  }
  if (!message) return;
  const sessionId = require('../../harness/memory').getSession(c.sessionId) ? c.sessionId : undefined;
  try { harness.post({ message, sessionId, attachments: kept ? [kept.name] : [] }, device); }
  catch (e) { await say(chatId, `⚠ ${e.message}`); }
}

module.exports = { onMessage, onCallback, HOWTO };
