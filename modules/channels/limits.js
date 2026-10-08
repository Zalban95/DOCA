'use strict';

/**
 * How much each channel takes when the agent sends files to a linked chat (tell_device `files`), so a file too large
 * is refused before anything is sent, with the channel's own limit in the sentence — not a 413 from somebody else's
 * server after half the files went. And how Telegram will show each file, which differs by type.
 *
 * Every file the hub sends is kept first as the chat's own media (api-v1/media.js), so 50 MB a file is the hub's
 * ceiling everywhere; a channel may take less.
 */
const MB = 1024 * 1024;
const HUB = 50 * MB;

const human = n => (n < MB ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / MB).toFixed(1)} MB`);

const CHANNELS = {
  telegram: { label: 'Telegram', perFile: HUB, says: 'a Telegram bot sends files up to 50 MB each' },
  // The homeserver's own m.upload.size may be lower; it then refuses the upload and the chat is told which file.
  matrix:   { label: 'Matrix', perFile: HUB, says: 'files go up to 50 MB each to Matrix (your homeserver may allow less)' },
  slack:    { label: 'Slack', perFile: HUB, says: 'the hub sends files up to 50 MB each to Slack' },
  // One mail carries every file of a notice; most servers refuse a mail over 25 MB once base64 has grown it by a third.
  mail:     { label: 'Mail', perFile: 20 * MB, total: 20 * MB, says: 'one mail carries at most 20 MB of files in all — most mail servers refuse more' },
};

/** Why this channel cannot take these files ({name, bytes}), or null. */
function refusal(channel, files) {
  const c = CHANNELS[channel];
  if (!c) return null;
  const big = files.find(f => f.bytes > c.perFile);
  if (big) return `${big.name} is ${human(big.bytes)} — ${c.says}.`;
  const sum = files.reduce((n, f) => n + f.bytes, 0);
  if (c.total && sum > c.total) return `These files are ${human(sum)} together — ${c.says}. Send fewer at a time.`;
  return null;
}

const PHOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * The Bot API method and field for a file: a photo, an audio track (Telegram's player takes MP3 and M4A), a voice
 * note (OGG/Opus), a video (MP4), an animation (GIF) — anything else, or a photo over Telegram's 10 MB, a document.
 */
function telegramMethod({ kind, mime, bytes }) {
  if (kind === 'image' && PHOTO.has(mime) && bytes <= 10 * MB) return ['sendPhoto', 'photo'];
  if (mime === 'image/gif') return ['sendAnimation', 'animation'];
  if (mime === 'audio/mpeg' || mime === 'audio/mp4') return ['sendAudio', 'audio'];
  if (mime === 'audio/ogg') return ['sendVoice', 'voice'];
  if (mime === 'video/mp4') return ['sendVideo', 'video'];
  return ['sendDocument', 'document'];
}

/** What the agent should know about how a channel shows these files (one line, or none). */
function note(channel, files) {
  if (channel === 'telegram') {
    const asFile = files.filter(f => (f.kind === 'audio' || f.kind === 'video') && telegramMethod(f)[0] === 'sendDocument');
    if (asFile.length) return `Telegram plays MP3, M4A, OGG and MP4 in the chat; ${asFile.map(f => f.name).join(', ')} arrive${asFile.length === 1 ? 's' : ''} as a file to download — convert first if they should play there.`;
  }
  if (channel === 'mail') return 'By mail they arrive as attachments of one message.';
  return '';
}

module.exports = { CHANNELS, refusal, telegramMethod, note, human, HUB };
