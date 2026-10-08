'use strict';

/**
 * Reaching a person: asking and telling a device, and showing media in the chat.
 */

const fs     = require('fs');
const path   = require('path');
const { resolvePath } = require('./common');

/**
 * Chat media is for looking at or listening to, and a phone on mobile data pays
 * for every byte. A still frame and a two-minute clip are not the same size of
 * thing, so the cap is not the same number.
 */
const SHOW_IMAGE_MAX = 20 * 1024 * 1024;
const SHOW_MEDIA_MAX = 200 * 1024 * 1024;
const { MAX_FILES } = require('../reach-files');

/** A file the agent may send to a device: inside the allowed roots, and never one holding secrets beside settings. */
function sendable(p, ctx) {
  const abs = resolvePath(p, ctx);
  if (require('../secret-view').kindOf(abs)) throw new Error(`${path.basename(abs)} holds secrets beside settings and is never sent.`);
  return abs;
}

/**
 * Copy a file into attachments and put it in the chat. One implementation
 * behind `show_media` and the `show_image` name it shipped under.
 */
function showMedia(p, caption, ctx = {}) {
  const attachments = require('../../attachments');
  const abs  = resolvePath(p, ctx);
  const mime = attachments.mimeFor(abs);
  const kind = attachments.playableKind(mime);
  if (!kind) throw unshowable(abs);

  const cap = kind === 'image' ? SHOW_IMAGE_MAX : SHOW_MEDIA_MAX;
  const bytes = fs.statSync(abs).size;
  if (bytes > cap)
    throw new Error(`${path.basename(abs)} is ${attachments.humanBytes(bytes)}; chat ${kind} is capped at `
      + `${attachments.humanBytes(cap)}. Re-encode it smaller and show that.`);

  // A file the hub itself just kept from an MCP tool (a computer's screenshot or recording, mcp/content.js) is
  // already an attachment: shown as it is, not copied a second time (each one was stored twice).
  const kept = path.dirname(require('../../utils').realOf(abs)) === require('../../utils').realOf(attachments.dir()) && attachments.get(path.basename(abs));
  const rec = kept && String(kept.from || '').startsWith('mcp:') ? kept
    : attachments.save(fs.readFileSync(abs), path.basename(abs), { from: 'agent', mime });
  const media = { name: rec.name, mime, kind, bytes, ...(caption ? { caption: String(caption).slice(0, 200) } : {}) };
  if (typeof ctx.show === 'function') ctx.show(media);
  return `Shown in the chat: ${rec.name} (${attachments.humanBytes(bytes)}, ${kind}). The user has it now; `
    + 'do not describe it again unless they ask.';
}

const unshowable = file => new Error(`${path.basename(file)} is not something a chat can show (images: png, jpg, webp, gif, avif, `
  + 'svg; video: mp4, webm, mov, mkv; audio: mp3, wav, ogg, m4a, flac, aac; documents: md, txt; 3D models: glb, gltf, stl, obj, fbx, ply, 3mf, usdz). Convert it '
  + 'first, for example: ffmpeg -i in.avi out.mp4');

/**
 * Show a file from inside a computer this conversation works in (self-test 2026-10-08: a Tester's screenshot was
 * "outside the allowed roots", and a specialist has no `computer get`). Copied out the way `computer get` does —
 * docker cp, kept as an attachment from mcp:computer-<id> — and only from the turn's own computer: a sandbox the
 * agent already drives, never another conversation's.
 */
async function showFromComputer(id, p, caption, ctx = {}) {
  const whose = require('../../computers/whose');
  const mine = whose.ofConversation(ctx.sessionId);
  if (!mine.includes(String(id)))
    throw new Error(`Computer ${id} is not one this conversation works in (${mine.length ? `yours: ${mine.join(', ')}` : 'it has none'}); `
      + 'show_media copies a file only out of your own computer.');
  whose.check(ctx.user, id);
  const attachments = require('../../attachments');
  if (!attachments.playableKind(attachments.mimeFor(String(p || '')))) throw unshowable(String(p || 'that file'));
  const kept = await require('../../computers').fetchFile(id, p);
  return showMedia(kept.path, caption, ctx);
}

module.exports = [
  {
    name: 'ask_device',
    description: 'Ask the user a multiple-choice question on one of their devices and wait for the answer. '
      + 'Use it when you cannot correctly continue without a decision only they can make — which of two paths, '
      + 'whether to go ahead, which file they meant. The question appears as a prompt they tap, so it reaches a '
      + 'watch or a phone that is asleep. It blocks this step until they answer, so ask one thing at a time and '
      + 'keep the choices short enough to read on a wrist. If nobody answers in time the question is withdrawn '
      + 'and you are told so — decide without it, and do not ask the same question again (standing rules). Use doca_clients first if you are unsure '
      + 'which device to reach.',
    parameters: {
      type: 'object',
      properties: {
        question:   { type: 'string', description: 'The question, in one sentence.' },
        choices:    { type: 'array', items: { type: 'string' }, description: 'Two to eight short answers to pick between. A "Not now" option is always added for them.' },
        to:         { type: 'string', description: 'Which device: an id, a form factor ("watch", "phone"), or a name. Omit to ask every device that can answer.' },
        note:       { type: 'string', description: 'Optional extra context shown under the question.' },
        timeoutSec: { type: 'integer', description: 'How long to wait for an answer. Default 120, maximum 900.' },
        svg:        { type: 'string', description: 'Optional drawing shown with it: one <svg> with a viewBox; a device gets it at its own screen size.' },
        layout:     { type: 'string', enum: ['quadrants'], description: 'With svg and up to 4 choices: the drawing fills a watch and its quarters (top-left, top-right, bottom-left, bottom-right) are choices 1–4. Label them in the drawing; keep it inside the circle.' },
      },
      required: ['question', 'choices'],
    },
    run: async ({ question, choices, to, note, timeoutSec, svg, layout }) => {
      const reach = require('../reach');
      const r = await reach.ask({ to, question, choices, note, timeoutSec, svg, layout });
      const who = r.targets.map(reach.label).join(', ');
      switch (r.status) {
        case 'answered':  return `${reach.label(r.device)} answered: "${r.label}" (choice ${r.choiceId}).`;
        case 'dismissed': return `${reach.label(r.device)} chose not to answer right now. Carry on without a decision, or do the part that does not need one.`;
        case 'timeout':   return `Nobody answered within ${r.waitedSec}s, so the question was withdrawn — it is no longer on ${who}, and nothing is waiting on it. Decide without it, say what you need, or ask again later.`;
        default:          return `The question closed before it was answered (${r.reason}). It was asked of ${who}.`;
      }
    },
  },
  {
    name: 'show_media',
    description: 'Put a picture, a video or a sound in this chat, from a file on this machine: a render, a chart, '
      + 'a screenshot, a recording, a clip. Images are drawn (png, jpg, webp, gif, avif, svg); video and audio get '
      + 'a player (mp4, webm, mov, mkv; mp3, wav, ogg, m4a, flac, aac). Show it rather than describing it. '
      + 'Markdown image syntax is NOT drawn, so this is the only way media reaches the chat. A copy is kept with '
      + 'the conversation, so changing the file later does not change what was shown. To put a picture on a device '
      + 'the user is carrying instead, use tell_device.',
    parameters: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'The media file. Absolute, or relative to the agent workspace — or, with computer, to that computer\'s work folder.' },
        caption: { type: 'string', description: 'One short line under it: what it is.' },
        computer: { type: 'string', description: 'The id of the computer you work in, when the file is inside it (a screenshot, a recording): it is copied out and shown.' },
      },
      required: ['path'],
    },
    run: ({ path: p, caption, computer }, ctx = {}) => (computer ? showFromComputer(computer, p, caption, ctx) : showMedia(p, caption, ctx)),
  },
  {
    // The name this shipped under. A conversation that already contains
    // `show_image` calls keeps working, and a model that learnt the old name
    // from an older transcript is not told it no longer exists.
    name: 'show_image',
    description: 'Deprecated alias of show_media, which also plays video and audio. Prefer show_media.',
    parameters: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'The image file. Absolute, or relative to the agent workspace.' },
        caption: { type: 'string', description: 'One short line under the picture: what it is.' },
      },
      required: ['path'],
    },
    run: ({ path: p, caption }, ctx = {}) => showMedia(p, caption, ctx),
  },
  {
    name: 'tell_device',
    description: 'Send a notice to one of the person\'s own devices or linked chats (phone, watch, desk, Telegram, Matrix, '
      + 'Slack, mail) — work finished, something needs their eyes — optionally with files: audio, video, documents, '
      + 'pictures, each with a caption. It does not wait for a reply and it is durable, so a device that is asleep gets '
      + 'it on waking. The hub uploads files the chat\'s own way (a Telegram audio track, a Matrix file, a mail '
      + 'attachment); never send to a chat any other way. A file a device cannot take is refused with its limit before '
      + 'anything is sent. For anything you need an answer to, use ask_device instead.',
    parameters: {
      type: 'object',
      properties: {
        title:     { type: 'string', description: 'The headline, short enough for a watch.' },
        text:      { type: 'string', description: 'Optional detail under the headline.' },
        files:     { type: 'array', description: `Optional files on this host to send with it, at most ${MAX_FILES}: audio, video, documents, pictures. A watch takes pictures only.`,
          items: { type: 'object', properties: {
            path:    { type: 'string', description: 'The file. Absolute, or relative to the agent workspace.' },
            caption: { type: 'string', description: 'One line about it, shown with the file.' },
          }, required: ['path'] } },
        imagePath: { type: 'string', description: 'Optional path to one picture to show with it (the same as one entry of files).' },
        svg:       { type: 'string', description: 'Optional drawing instead of a file: one <svg> with a viewBox, drawn at the screen size of the device.' },
        to:        { type: 'string', description: 'Which device or chat: an id, a form factor ("watch", "phone"), or a name ("Telegram"). Omit to tell every device of the person that receives notices.' },
        urgent:    { type: 'boolean', description: 'True only if it should break through quiet hours.' },
      },
      required: ['title'],
    },
    run: ({ title, text, imagePath, files, svg, to, urgent }, ctx = {}) => {
      const reach = require('../reach');
      const list = [...(imagePath ? [{ path: imagePath }] : []), ...(Array.isArray(files) ? files : files ? [files] : [])]
        .map(f => (typeof f === 'string' ? { path: f } : f || {}))
        .map(f => ({ path: sendable(f.path, ctx), caption: f.caption }));
      const r = reach.tell({ to, title, text, urgent, svg, files: list, personId: ctx.user?.id || null });
      const rows = r.delivered.map(d => `${reach.label(d.device)} — ${d.note}${d.files ? `\n  ${d.files}` : ''}`).join('\n');
      const what = r.files.length ? ` with ${r.files.length === 1 ? r.files[0].name : `${r.files.length} files`} (${require('../../channels/limits').human(r.imageBytes)})` : '';
      return `Sent${what} to:\n${rows}`;
    },
  },
  {
    // CONSTITUTION S4 (TODO P1.3): the hub hands the value to the device sealed for it; the agent only ever names it.
    name: 'secret_use',
    description: 'Type or paste a password, PIN or key on one of the person\'s own devices without ever seeing it: '
      + 'the hub hands it to that device sealed, for one use (or a few pastes) and a short time, then the device forgets it. '
      + 'With ref (and tab), the person\'s browser fills that field from browser_snapshot — only on the secret\'s own site; '
      + 'without, a desktop puts it on its clipboard for `uses` pastes or `seconds` (mode "clipboard", the default) or types it into what has focus (mode "type"). '
      + 'Always asked of the person. The secrets are listed under "What you have" in the readings.',
    parameters: {
      type: 'object',
      properties: {
        secret:  { type: 'string', description: 'The secret\'s name; a login\'s password is login:<name>, a key for services key:<name>.' },
        device:  { type: 'string', description: 'The device\'s id or name (doca_clients lists them).' },
        ref:     { type: 'number', description: 'In the person\'s browser: the [n] of the field from browser_snapshot.' },
        tab:     { type: 'number', description: 'In the person\'s browser: the tab id (omitted: the tab in front).' },
        mode:    { type: 'string', enum: ['clipboard', 'type'], description: 'On a desktop: clipboard (default) or type into what has focus.' },
        uses:    { type: 'integer', description: 'Clipboard pastes before it is forgotten: 1 (default) to 10.' },
        seconds: { type: 'integer', description: 'How long the device may keep it: 30 by default, 5 to 300.' },
      },
      required: ['secret', 'device'],
    },
    run: (a, ctx = {}) => require('../../sealed/use').use(a, ctx),
  },
];
