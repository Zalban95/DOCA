'use strict';

/**
 * Mail as a channel of the hive (TODO H9.1): a mailbox this hub reads over IMAP and answers from over SMTP — any
 * provider, or one the person runs. Each address a person links is a device of kind `channel` bound to them: a mail
 * from it is a turn in its own conversation (../converse.js), the answer comes back as a reply in the same thread.
 *
 * A From line is only a claim, so a mail counts only when the receiving server vouched for the sender
 * (mime.trusted: DMARC, or DKIM for the From domain, in the Authentication-Results its server wrote) — otherwise
 * anyone could write as the owner. Automatic mail (Auto-Submitted, bounces, our own) is never answered. Polled every
 * `channels.mail.pollSec`; off until a host saves the mailbox and switches it on.
 */
const links = require('../links').forChannel('mail');
const mime = require('./mime');

const CAPS = { formFactor: 'other', input: { text: true }, render: ['text'], ext: { channel: 'mail' } };
const state = { running: false, timer: null, lastPollAt: null, error: null, busy: false };
const prefs = () => require('../../utils').loadPrefs().channels?.mail || {};
const schema = () => require('../../settings-schema');
const enabled = () => schema().value('channels.mail.enabled') === true && !!prefs().imapHost && !!prefs().user;
const bind = require('../bind').binder({ label: 'Mail', links, caps: CAPS,
  onEvent: (addr, deviceId, env) => require('./outbound').onEvent(addr, deviceId, env), onError: e => { state.error = e.message; } });

const server = (kind, p = prefs()) => ({ host: p[`${kind}Host`] || p.imapHost, port: Number(p[`${kind}Port`]) || (kind === 'imap' ? 993 : 465),
  tls: p.tls !== false, user: p.user, pass: process.env.DOCA_MAIL_PASSWORD || p.password });

async function onMail(raw) {
  const m = mime.parse(raw);
  const p = prefs();
  const own = String(p.address || p.user || '').toLowerCase();
  if (!m.from || m.from === own || /^(mailer-daemon|postmaster)@/i.test(m.from) || (m.autoSubmitted && !/^no$/i.test(m.autoSubmitted))) return;
  if (!mime.trusted(m, p.authservId)) {
    state.error = `ignored a mail claiming to be from ${m.from}: its server did not vouch for it (no DMARC or DKIM pass)`;
    return;
  }
  links.saveChat(m.from, links.chat(m.from) ? { lastSubject: m.subject, lastMessageId: m.messageId } : {});
  const say = (addr, t) => require('./outbound').say(addr, t, { subject: m.subject, inReplyTo: m.messageId });
  const file = m.files[0];
  const keep = file ? deviceId => require('../converse').keepFile({ buffer: file.buffer, name: file.name.slice(0, 120), mime: file.mime, speech: /^audio\//.test(file.mime) }, deviceId) : undefined;
  const text = m.text || (/\blink\s+([0-9A-F]{10})\b/i.exec(m.subject)?.[0] ?? '');
  await require('../converse').handle({ label: 'Mail', links, bind, say, answer: require('./outbound').answer },
    { addr: m.from, text: /^\s*link\s+[0-9A-F]{10}\b/i.test(text) ? `!${text.trim()}` : text, from: { who: m.fromHeader || m.from, username: m.from }, keep });
  if (links.chat(m.from)) links.saveChat(m.from, { lastSubject: m.subject, lastMessageId: m.messageId });
}

async function poll() {
  if (state.busy) return;
  state.busy = true;
  let c;
  try {
    c = await require('./imap').connect(server('imap'));
    await c.login(server('imap').user, server('imap').pass);
    await c.select('INBOX');
    for (const uid of await c.unseen()) {
      const raw = await c.fetch(uid);
      await c.seen(uid);   // read once, whatever happens next: a mail that broke the handler is not answered twice
      if (raw) await bind.queue(mime.parse(raw).from, () => onMail(raw));
    }
    await c.logout();
    state.lastPollAt = new Date().toISOString();
    if (!/^ignored a mail/.test(state.error || '')) state.error = null;
  } catch (e) { state.error = e.message; c?.close(); }
  finally { state.busy = false; }
}

async function start() {
  stop();
  if (!enabled()) return status();
  state.running = true;
  bind.attachAll();
  await poll();
  state.timer = setInterval(poll, Math.max(5, schema().value('channels.mail.pollSec')) * 1000);
  state.timer.unref?.();
  return status();
}

function stop() { clearInterval(state.timer); state.timer = null; state.running = false; bind.detachAll(); }

function unlink(addr) {
  const c = bind.unlink(addr);
  if (c) require('./outbound').say(addr, 'This address was unlinked from DOCA.').catch(() => {});
  return c;
}

function status() {
  const p = prefs();
  return { env: ['DOCA_MAIL_PASSWORD'].filter(k => process.env[k]), enabled: p.enabled === true, configured: !!(p.imapHost && p.user), hasPassword: !!(process.env.DOCA_MAIL_PASSWORD || p.password), running: state.running,
    error: state.error, lastPollAt: state.lastPollAt, bot: p.address || p.user ? { username: p.address || p.user } : null,
    imapHost: p.imapHost || null, smtpHost: p.smtpHost || null, user: p.user || null, authservId: p.authservId || null };
}

module.exports = { start, stop, status, unlink, poll, bind, links, server };
