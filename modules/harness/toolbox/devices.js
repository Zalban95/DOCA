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

/**
 * Copy a file into attachments and put it in the chat. One implementation
 * behind `show_media` and the `show_image` name it shipped under.
 */
function showMedia(p, caption, ctx = {}) {
  const attachments = require('../../attachments');
  const abs  = resolvePath(p, ctx);
  const mime = attachments.mimeFor(abs);
  const kind = attachments.playableKind(mime);
  if (!kind)
    throw new Error(`${path.basename(abs)} is not something a chat can show (images: png, jpg, webp, gif, avif, `
      + 'svg; video: mp4, webm, mov, mkv; audio: mp3, wav, ogg, m4a, flac, aac; documents: md, txt). Convert it '
      + 'first, for example: ffmpeg -i in.avi out.mp4');

  const cap = kind === 'image' ? SHOW_IMAGE_MAX : SHOW_MEDIA_MAX;
  const bytes = fs.statSync(abs).size;
  if (bytes > cap)
    throw new Error(`${path.basename(abs)} is ${attachments.humanBytes(bytes)}; chat ${kind} is capped at `
      + `${attachments.humanBytes(cap)}. Re-encode it smaller and show that.`);

  const rec = attachments.save(fs.readFileSync(abs), path.basename(abs), { from: 'agent', mime });
  const media = { name: rec.name, mime, kind, bytes, ...(caption ? { caption: String(caption).slice(0, 200) } : {}) };
  if (typeof ctx.show === 'function') ctx.show(media);
  return `Shown in the chat: ${rec.name} (${attachments.humanBytes(bytes)}, ${kind}). The user has it now; `
    + 'do not describe it again unless they ask.';
}


module.exports = [
  {
    name: 'ask_device',
    description: 'Ask the user a multiple-choice question on one of their devices and wait for the answer. '
      + 'Use it when you cannot correctly continue without a decision only they can make — which of two paths, '
      + 'whether to go ahead, which file they meant. The question appears as a prompt they tap, so it reaches a '
      + 'watch or a phone that is asleep. It blocks this step until they answer, so ask one thing at a time and '
      + 'keep the choices short enough to read on a wrist. If nobody answers in time the question is withdrawn '
      + 'and you are told so — decide without it or ask again later. Use doca_clients first if you are unsure '
      + 'which device to reach.',
    parameters: {
      type: 'object',
      properties: {
        question:   { type: 'string', description: 'The question, in one sentence.' },
        choices:    { type: 'array', items: { type: 'string' }, description: 'Two to eight short answers to pick between. A "Not now" option is always added for them.' },
        to:         { type: 'string', description: 'Which device: an id, a form factor ("watch", "phone"), or a name. Omit to ask every device that can answer.' },
        note:       { type: 'string', description: 'Optional extra context shown under the question.' },
        timeoutSec: { type: 'integer', description: 'How long to wait for an answer. Default 120, maximum 900.' },
      },
      required: ['question', 'choices'],
    },
    run: async ({ question, choices, to, note, timeoutSec }) => {
      const reach = require('../reach');
      const r = await reach.ask({ to, question, choices, note, timeoutSec });
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
        path:    { type: 'string', description: 'The media file. Absolute, or relative to the agent workspace.' },
        caption: { type: 'string', description: 'One short line under it: what it is.' },
      },
      required: ['path'],
    },
    run: ({ path: p, caption }, ctx = {}) => showMedia(p, caption, ctx),
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
    description: 'Send a notice to one of the user\'s devices — work finished, something needs their eyes, a step '
      + 'done — optionally with a picture. It does not wait for a reply and it is durable, so a watch that is '
      + 'asleep gets it on waking. Use `imagePath` to show a rendered image, a screenshot or a chart you have '
      + 'just produced; the file has to be on this host and a picture too large to send says so rather than '
      + 'failing quietly. For anything you need an answer to, use ask_device instead.',
    parameters: {
      type: 'object',
      properties: {
        title:     { type: 'string', description: 'The headline, short enough for a watch.' },
        text:      { type: 'string', description: 'Optional detail under the headline.' },
        imagePath: { type: 'string', description: 'Optional path to a png, jpg, webp or gif on this host to show with it.' },
        to:        { type: 'string', description: 'Which device: an id, a form factor ("watch", "phone"), or a name. Omit to tell every device that receives notices.' },
        urgent:    { type: 'boolean', description: 'True only if it should break through quiet hours.' },
      },
      required: ['title'],
    },
    run: ({ title, text, imagePath, to, urgent }) => {
      const reach = require('../reach');
      const r = reach.tell({ to, title, text, urgent, imagePath: imagePath ? resolvePath(imagePath) : undefined });
      const rows = r.delivered.map(d => `${reach.label(d.device)} — ${d.note}`).join('\n');
      return `Sent${r.imageBytes ? ` with a ${Math.round(r.imageBytes / 1024)} KB picture` : ''} to:\n${rows}`;
    },
  },
];
