'use strict';

/**
 * Files the agent sends to the person (tell_device `files`): audio, video, documents, pictures, with a caption each,
 * to their phone, desk or a linked chat. Asked on 2026-10-08 after the agent, told to send nine voice samples to the
 * owner's Telegram, had no tool for it and wrote a script that loaded the channel's module with the bot token from
 * the settings file — it worked, and it went around every rule the channel layer keeps.
 *
 * One road, the one pictures already took (reach.js): each file is stored as its recipient's own media, so exactly
 * that device may fetch it, for 24 h, and a media block in the notice says what it is (`kind`, `mime`, `name`,
 * `bytes`, `caption`). A linked chat is a device too — its channel (channels/deliver.js) reads the same blocks and
 * uploads the bytes the channel's way, so a token never leaves the channel's own module. What a device cannot take
 * is refused before anything is stored, with that device's limit in the sentence.
 */
const fs = require('fs');
const path = require('path');

const MAX_FILES = 10;
/** The pictures a watch draws (media's own upload types): it is not given the rest. */
const WATCH_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const limits = () => require('../channels/limits');
const media = () => require('../api-v1/media');

/** The files as the tool was given them — paths, or {path, caption} — read from disk: name, type, kind, size. */
function read(files) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean)
    .map(f => (typeof f === 'string' ? { path: f } : f));
  if (!list.length) return [];
  if (list.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files a notice; send the rest in another.`);
  const attachments = require('../attachments');
  return list.map(f => {
    const abs = path.resolve(String(f.path || ''));
    let st;
    try { st = fs.statSync(abs); } catch { throw new Error(`No such file: ${abs}`); }
    if (!st.isFile()) throw new Error(`${abs} is not a file.`);
    if (!st.size) throw new Error(`${path.basename(abs)} is empty.`);
    const mime = attachments.mimeFor(abs);
    return { abs, name: path.basename(abs), mime, kind: attachments.playableKind(mime) || 'file', bytes: st.size,
      caption: String(f.caption || '').trim().slice(0, 1000) };
  });
}

/** Why this device cannot take these files, or null. */
function refusal(d, files) {
  const who = `${d.name}`;
  const channel = d.caps?.ext?.channel;
  if (channel) { const why = limits().refusal(channel, files); return why && `${who}: ${why}`; }
  if (d.caps?.formFactor === 'watch') {
    const other = files.find(f => !WATCH_IMAGES.has(f.mime));
    if (other) return `${who} is a watch: it shows pictures only (png, jpg or webp), so ${other.name} cannot go there — send it to the phone or a linked chat.`;
    const big = files.find(f => f.bytes > require('../api-v1/limits').MEDIA_BYTES);
    if (big) return `${who} is a watch: a picture goes up to 1.5 MB, and ${big.name} is ${limits().human(big.bytes)} — scale it down first.`;
    return null;
  }
  const big = files.find(f => f.bytes > media().OUTBOUND_BYTES);
  if (big) return `${who}: ${big.name} is ${limits().human(big.bytes)} — the hub sends files up to 50 MB each to an app.`;
  return null;
}

/**
 * Store each file once per recipient and return each recipient's media blocks. Refuses first — before anything is
 * stored — if any recipient cannot take the files.
 */
function attach(files, targets) {
  const no = targets.map(d => refusal(d, files)).filter(Boolean);
  if (no.length) throw new Error(`Nothing was sent. ${no.join(' ')}`);
  const blocks = new Map(targets.map(d => [d.id, []]));
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    for (const d of targets) {
      const watch = d.caps?.formFactor === 'watch';
      let rec;
      try { rec = media().save(buf, f.mime, d.id, { source: 'agent', name: f.name, outbound: !watch }); }
      catch (e) { throw new Error(`${f.name} could not be sent to ${d.name}: ${e.message}`); }
      blocks.get(d.id).push({ type: 'media', mediaId: rec.id, alt: f.caption || f.name, kind: rec.kind === 'other' ? 'file' : rec.kind,
        mime: rec.mime, name: f.name, bytes: f.bytes, ...(f.caption ? { caption: f.caption } : {}) });
    }
  }
  return blocks;
}

/** One line the agent reads about how a recipient shows them, or ''. */
const noteFor = (d, files) => (d.caps?.ext?.channel ? limits().note(d.caps.ext.channel, files) : '');

module.exports = { read, refusal, attach, noteFor, MAX_FILES };
