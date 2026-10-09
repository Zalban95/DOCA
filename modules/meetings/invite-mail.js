'use strict';

/**
 * An invitation by mail, the way calendars send them: multipart/mixed holding a multipart/alternative of the words and
 * the `text/calendar; method=REQUEST` part (what Gmail, Outlook and Apple Mail show as a meeting with its buttons), and
 * the same calendar as an `invite.ics` attachment for a client that only saves files. Sent through the mail channel's
 * own SMTP server (Settings → Channels → Mail), so DOCA needs no second mail account.
 */
const crypto = require('crypto');

const prefs = () => require('../utils').loadPrefs().channels?.mail || {};

/** Whether the hub can send mail: the mail channel's server and account are set. */
function ready() {
  const p = prefs();
  return !!((p.smtpHost || p.imapHost) && p.user);
}

const from = () => prefs().address || prefs().user;
const enc = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${Buffer.from(s).toString('base64')}?=`);
const b64 = s => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');

function raw({ to, subject, text, ics, method }) {
  const sender = from(), domain = String(sender || '').split('@')[1] || 'doca.local';
  const mixed = `doca-m-${crypto.randomUUID()}`, alt = `doca-a-${crypto.randomUUID()}`;
  return [
    `From: ${sender}`, `To: ${to}`, `Subject: ${enc(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`, 'MIME-Version: 1.0', 'Auto-Submitted: auto-generated',
    `Content-Type: multipart/mixed; boundary="${mixed}"`, '',
    `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(text),
    `--${alt}`, `Content-Type: text/calendar; charset=utf-8; method=${method}`, 'Content-Transfer-Encoding: base64', '', b64(ics),
    `--${alt}--`,
    `--${mixed}`, `Content-Type: application/ics; name="invite.ics"`, 'Content-Disposition: attachment; filename="invite.ics"',
    'Content-Transfer-Encoding: base64', '', b64(ics),
    `--${mixed}--`, '',
  ].join('\r\n');
}

/** Send one invitation (or cancellation). Throws when the server refuses. */
async function send({ to, subject, text, ics, method = 'REQUEST' }) {
  if (!ready()) throw new Error('mail is not set up (Settings → Channels → Mail)');
  const message = raw({ to, subject, text, ics, method });
  await require('../channels/mail/smtp').send(require('../channels/mail').server('smtp'), { from: from(), to, raw: message });
  return message;
}

module.exports = { ready, send, raw };
