'use strict';

/**
 * What a chat on any channel says to the hive, once it is past the channel's own checks (a private chat, not a
 * bot). A link code binds the chat; an unlinked chat gets instructions; `/new` and `/stop` are the commands
 * every channel has; anything else is a turn through the adapter a phone's message goes through (api-v1/harness
 * post), as the chat's device — so the charter, the person's level, approvals and the queue for a working
 * conversation are the ones every client gets. A voice note's transcript is sent with a note to answer as speech.
 *
 *   handle(ch, { addr, text, from: { who, username }, keep })
 *     ch    { label, links, bind, say(addr, text), answer?(addr, text, device) → true when the text answered a question }
 *     keep  async deviceId → { name, transcript, sttError } | null — the file the message carried, saved as an attachment
 */
const howto = label => `This is a DOCA hive. To talk to it here, open DOCA → Settings → Channels → "Link a ${label} chat" and send the code it gives you.`;

/** Who was asked to approve a waiting chat, in a sentence. */
const waiting = id => require('../devices-approval').selfView(require('../api-v1/devices').get(id)).message || '';

async function handle(ch, { addr, text = '', from = {}, keep = async () => null }) {
  const say = t => ch.say(addr, t);
  text = String(text).trim();
  const code = (/^[/!](?:start|link)\s+(\S+)/.exec(text) || [])[1];
  let c = ch.links.chat(addr);
  if (code) {
    const hit = ch.links.redeem(code);
    if (!hit) return void await say('That code is unknown or has expired. Make a new one in DOCA → Settings → Channels.');
    try { c = ch.bind.link(addr, { who: from.who || String(addr), username: from.username || null }, hit.userId); }
    catch (e) { if (/^licence_/.test(e.code || '')) return void await say(e.message); throw e; }   // the licence's devices (license/limits.js)
    const waits = require('../api-v1/devices').isPending(require('../api-v1/devices').get(c.deviceId));
    if (waits) return void await say(`Linked to ${c.personName}, and waiting for approval: ${waiting(c.deviceId)} You will be told here when it is allowed.`);
    return void await say(`Linked to ${c.personName}. Write here to talk to DOCA — voice notes, photos and files too. /new starts a fresh conversation, /stop stops the one running.`);
  }
  if (!c) return void await say(howto(ch.label));
  const device = require('../api-v1/devices').get(c.deviceId);
  if (!device || device.revokedAt) return void await say(`This chat was unlinked in DOCA. Link it again from Settings → Channels.`);
  if (require('../api-v1/devices').isPending(device)) return void await say(`This chat waits for approval: ${waiting(device.id)} Nothing is sent to ${require('../branding').name('product')} until then.`);
  const harness = require('../api-v1/harness');
  if (/^[/!]start\b/.test(text)) return void await say(`Linked to ${c.personName}. Write here to talk to DOCA.`);
  if (/^[/!]new\b/.test(text)) {
    const s = harness.createSession(ch.label, { activate: false, device });
    ch.links.saveChat(addr, { sessionId: s.id });
    return void await say('A fresh conversation. Write away.');
  }
  if (/^[/!]stop\b/.test(text)) {
    try { harness.cancel(c.sessionId, device); return void await say('Stopping at the next step.'); }
    catch { return void await say('Nothing is running.'); }
  }
  if (text && ch.answer && await ch.answer(addr, text, device)) return;
  let kept = null;
  try { kept = await keep(device.id); } catch (e) { await say(`(the file could not be fetched: ${e.message})`); }
  let message = text;
  if (kept?.transcript) {
    message = `${kept.transcript}\n\n[Sent as a ${ch.label} voice note; the text above is its transcript, and the recording is attached. `
      + 'Answer as if speaking: a few sentences, no lists, no code — unless the message asks for something else.]';
  } else if (kept && !message) {
    message = kept.sttError ? `(a voice note — it could not be transcribed: ${kept.sttError})` : '(sent a file)';
  }
  if (!message) return;
  const sessionId = require('../harness/memory').getSession(c.sessionId) ? c.sessionId : undefined;
  try { harness.post({ message, sessionId, attachments: kept ? [kept.name] : [] }, device); }
  catch (e) { await say(`⚠ ${e.message}`); }
}

/** A file a chat sent, kept as an attachment from its device; speech is transcribed by the panel's STT. */
async function keepFile({ buffer, name, mime, speech }, deviceId) {
  const a = require('../attachments').save(buffer, name, { from: deviceId, mime });
  let transcript = null, sttError;
  if (speech) {
    try { transcript = await require('../chat').transcribeAudio(buffer, mime || 'audio/ogg', name); }
    catch (e) { sttError = e.message; }
  }
  return { name: a.name, transcript, sttError };
}

module.exports = { handle, keepFile, howto };
