'use strict';

/**
 * What the hive says to a linked chat, on any channel: the chat's device is subscribed to the bus like any
 * client (bind.js), and its events become messages — the answer to a turn it asked for (with the pictures), a
 * question, the question closed where it was answered elsewhere, a notice with its files (tell_device). The channel
 * says how:
 *
 *   ch { say(addr, text), typing?(addr), file(addr, f), notice?(addr, text, files), ask(addr, prompt, text), closed(addr, promptId, reason) }
 *
 * where a file `f` is { name, mime, kind, buffer, caption } — uploaded by the channel's own module, so its token never
 * leaves it — and `notice` is for a channel that sends a notice's text and files as one message (mail).
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
        for (const img of p.images || []) {
          const f = attachmentOf(img);
          if (f) await ch.file(addr, f).catch(e => ch.say(addr, `(a picture could not be sent: ${e.message})`));
        }
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
    case 'alert': {
      const body = Array.isArray(p.body) ? p.body : [];
      const text = [p.title, p.text || blockText(body.filter(b => b?.type !== 'media'))].filter(Boolean).join('\n') || 'A notice';
      const files = body.filter(b => b?.type === 'media').map(fileOf);
      const lost = files.filter(f => !f.buffer).map(f => f.name);
      const ready = files.filter(f => f.buffer);
      if (ch.notice && ready.length) await ch.notice(addr, text, ready);
      else {
        await ch.say(addr, text);
        // One file that fails is said in the chat; the rest still go, and the notice is not sent again for it.
        for (const f of ready) await ch.file(addr, f).catch(e => ch.say(addr, `(${f.name} could not be sent: ${e.message})`));
      }
      if (lost.length) await ch.say(addr, `(${lost.join(', ')} ${lost.length === 1 ? 'is' : 'are'} no longer on the hub — files are kept 24 hours.)`);
      return;
    }
    // A chat that waited for approval (devices-approval/) is told the answer.
    case 'device.approved':
      return void await ch.say(addr, `${p.by || 'Someone'} allowed this chat. Write here to talk to ${require('../branding').name('product')}.`);
    case 'device.refused':
      return void await ch.say(addr, `${p.by || 'Someone'} refused this chat, so it is unlinked. Link it again from ${require('../branding').name('product')} → Settings → Channels if that was a mistake.`);
    default:
  }
}

/** The choices a person can answer from a chat: options and a dismiss, never free text (a different job). */
const choicesOf = q => (q.choices || []).filter(c => c.type === 'option' || c.type === 'dismiss');

/** An attachment the agent showed (show_media), as a file for the channel. */
function attachmentOf(image) {
  const attachments = require('../attachments');
  const a = attachments.get(image.name);
  if (!a) return null;
  return { name: a.name, mime: a.mime, buffer: require('fs').readFileSync(a.path), kind: image.kind || attachments.playableKind?.(a.mime) || 'image',
    caption: image.caption || '' };
}

/** A notice's media block, as a file for the channel: the chat's own copy (reach-files.js), or no buffer once expired. */
function fileOf(b) {
  const media = require('../api-v1/media');
  const rec = media.get(b.mediaId);
  const name = b.name || rec?.meta?.name || rec?.id || 'file';
  return { name, mime: rec?.mime || b.mime || 'application/octet-stream', kind: b.kind || rec?.kind || 'file',
    caption: b.caption || '', buffer: rec ? media.readBuffer(rec.id) : null };
}

module.exports = { onEvent, split, choicesOf, attachmentOf, fileOf };
