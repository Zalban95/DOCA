'use strict';

/**
 * How the hive's messages look in Slack (the events and their order are every channel's: ../deliver.js): plain
 * text (`mrkdwn: false`, as typed), pictures and files uploaded, a question as Block Kit buttons — answered through
 * Socket Mode's `block_actions` — and the question's message updated when it is answered here or elsewhere.
 */
const crypto = require('crypto');
const api = require('./api');
const deliver = require('../deliver');

const MAX = 3500;   // a message's text is cut at 40,000 characters; blocks at 3,000 — stay readable
const links = () => require('./index').links;

async function say(channel, text, extra = {}) {
  let last = null;
  for (const part of deliver.split(text, MAX)) last = await api.call('chat.postMessage', { channel, text: part, mrkdwn: false, ...extra });
  return last;
}

/** A file — a picture shown, or one sent (tell_device) — uploaded into the DM, its caption as the comment. */
const file = (channel, f) => api.upload(channel, f);

const plain = text => ({ type: 'section', text: { type: 'plain_text', text: String(text).slice(0, 2900) } });

const channel = {
  say: (c, t) => say(c, t),
  file,
  async ask(c, q, text) {
    const choices = deliver.choicesOf(q);
    if (!choices.length) return void await say(c, text);
    const m = await say(c, text, { blocks: [plain(text), { type: 'actions', block_id: `p|${q.id}`.slice(0, 255),
      elements: choices.slice(0, 25).map(ch => ({ type: 'button', text: { type: 'plain_text', text: String(ch.label || ch.id).slice(0, 75) },
        action_id: `p|${q.id}|${ch.id}`.slice(0, 255), value: String(ch.id).slice(0, 2000) })) }] });
    if (m) links().promptMessage(q.id, { channel: c, ts: m.ts, text });
  },
  async closed(c, promptId, reason) {
    const where = links().promptMessage(promptId);
    if (where?.channel === c) await api.call('chat.update', { channel: c, ts: where.ts, text: `${where.text}\n\n(${reason})`, blocks: [plain(`${where.text}\n\n(${reason})`)] }).catch(() => {});
  },
};

/** A button pressed in a DM: the question it belongs to is answered as the room's device. */
async function onAction(p) {
  const a = (p.actions || [])[0];
  const [kind, promptId, choiceId] = String(a?.action_id || '').split('|');
  const c = links().chat(p.channel?.id);
  if (kind !== 'p' || !c) return;
  const text = p.message?.text || '';
  const settle = line => api.call('chat.update', { channel: p.channel.id, ts: p.message?.ts, text: `${text}\n\n${line}`, blocks: [plain(`${text}\n\n${line}`)] }).catch(() => {});
  try {
    await require('../../api-v1/prompts').select(promptId, require('../../api-v1/devices').get(c.deviceId), { selectionId: crypto.randomUUID(), choiceId });
    await settle(`→ ${a.text?.text || choiceId}`);
  } catch (e) { await settle(e.status === 409 ? '(already answered or closed)' : `⚠ ${e.message.slice(0, 180)}`); }
}

const onEvent = (c, deviceId, env) => deliver.onEvent(channel, c, deviceId, env);

module.exports = { onEvent, onAction, say };
