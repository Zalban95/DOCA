'use strict';

/**
 * What the hive says to a linked chat, on any channel: the chat's device is subscribed to the bus like any
 * client (bind.js), and its events become messages — the answer to a turn it asked for (with the pictures), a
 * question, the question closed where it was answered elsewhere, a notice (tell_device). The channel says how:
 *
 *   ch { say(addr, text), typing?(addr), picture(addr, image), ask(addr, prompt, text), closed(addr, promptId, reason) }
 *
 * A throw leaves a durable event unacknowledged, so it is sent again when the channel is back.
 */
const blockText = blocks => (Array.isArray(blocks) ? blocks : []).map(b => b?.text || b?.alt || '').filter(Boolean).join('\n');

/** Text cut into parts a channel takes (`max` characters), at a line break when one is near. */
function split(text, max) {
  const out = []; let s = String(text || '');
  while (s.length > max) {
    const nl = s.lastIndexOf('\n', max);
    const cut = nl > max / 2 ? nl : max;
    out.push(s.slice(0, cut)); s = s.slice(cut).replace(/^\n/, '');
  }
  if (s) out.push(s);
  return out;
}

async function onEvent(ch, addr, deviceId, env) {
  const p = env.payload || {};
  switch (env.type) {
    case 'agent.turn':
      if (p.by !== deviceId) return;   // the chat's own turns; the rest of the person's work stays in the panel
      if (p.state === 'started') return void (ch.typing && Promise.resolve(ch.typing(addr)).catch(() => {}));
      if (p.state === 'done') {
        if (p.text) await ch.say(addr, p.text);
        for (const img of p.images || []) await ch.picture(addr, img).catch(e => ch.say(addr, `(a picture could not be sent: ${e.message})`));
        if (p.proposals?.length) await ch.say(addr, `${p.proposals.length} settings change${p.proposals.length === 1 ? '' : 's'} waiting for you in the panel.`);
        return;
      }
      if (p.state === 'failed') return void await ch.say(addr, `⚠ ${p.error?.message || 'The turn failed.'}`);
      if (p.state === 'cancelled') return void await ch.say(addr, 'Stopped.');
      return;
    case 'prompt.new': {
      const q = p.prompt || {};
      return void await ch.ask(addr, q, [q.title, blockText(q.body)].filter(Boolean).join('\n\n') || 'A question');
    }
    case 'prompt.closed':
      return void await ch.closed(addr, p.promptId, p.reason === 'answered' ? 'answered elsewhere' : p.reason || 'closed');
    case 'alert':
      await ch.say(addr, [p.title, p.text || p.body].filter(Boolean).join('\n') || 'A notice');
      if (p.image?.name) await ch.picture(addr, p.image).catch(() => {});
      return;
    default:
  }
}

/** The choices a person can answer from a chat: options and a dismiss, never free text (a different job). */
const choicesOf = q => (q.choices || []).filter(c => c.type === 'option' || c.type === 'dismiss');

/** An attachment the agent showed, with the channel's word for its kind. */
function attachmentOf(image) {
  const attachments = require('../attachments');
  const a = attachments.get(image.name);
  if (!a) return null;
  return { ...a, buffer: require('fs').readFileSync(a.path), kind: image.kind || attachments.playableKind?.(a.mime) || 'image' };
}

module.exports = { onEvent, split, choicesOf, attachmentOf };
