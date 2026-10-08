'use strict';

/**
 * A mailbox by app password (Gmail, iCloud, Fastmail, any IMAP and SMTP): the agent lists folders, searches, reads
 * and writes drafts, and sends — sending is always a person's decision (harness/forced-asks.js), in every approval
 * mode, never "always". IMAP and SMTP are DOCA's own (modules/mail/, shared with the mail channel). The password lives
 * in the vault and goes only to the two servers named here; a connection without TLS is refused except to this
 * machine (a local bridge such as Proton Mail Bridge, or the tests' stubs).
 */
const imap = require('../../mail/imap');
const smtp = require('../../mail/smtp');
const mime = require('../../mail/mime');
const presets = require('../presets');

const SECRETS = ['password'];
const HOST = /^[a-z0-9.-]{1,253}$/i;
const ADDR = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$|^[^\s@<>",;]+@localhost$/i;
const LOCAL = /^(127\.\d+\.\d+\.\d+|localhost|::1)$/i;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function accept(b, prev = {}) {
  const MASK = require('../../secrets-mask').MASK;
  const base = presets.MAIL[b.provider] || presets.MAIL[prev.provider] || presets.MAIL.other;
  const pick = k => (b[k] !== undefined && b[k] !== '' ? b[k] : prev[k] ?? base[k]);
  const next = { provider: presets.MAIL[b.provider] ? b.provider : prev.provider || 'other' };
  next.address = String(pick('address') || '').trim().toLowerCase();
  if (!ADDR.test(next.address)) throw bad('Give the mailbox\'s address, like you@example.com.');
  next.user = String(b.user || prev.user || next.address).trim().slice(0, 200);
  for (const k of ['imapHost', 'smtpHost']) {
    next[k] = String(pick(k) || '').trim();
    if (!HOST.test(next[k])) throw bad(`${k === 'imapHost' ? 'The IMAP server' : 'The SMTP server'} is a host name, like imap.example.com.`);
  }
  for (const k of ['imapPort', 'smtpPort']) {
    const n = Number(pick(k));
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw bad(`${k} is a port number.`);
    next[k] = n;
  }
  next.smtpSecurity = ['tls', 'starttls'].includes(pick('smtpSecurity')) ? pick('smtpSecurity') : 'tls';
  next.tls = b.tls === false || (b.tls === undefined && prev.tls === false) ? false : true;
  if (!next.tls && !(LOCAL.test(next.imapHost) && LOCAL.test(next.smtpHost))) throw bad('Mail goes over TLS: a connection without it is only for a bridge on this machine.');
  if (typeof b.password === 'string' && b.password && b.password !== MASK) next.password = b.password;
  else if (!prev.password) throw bad('Paste the app password.');
  return next;
}

const view = rec => ({ configured: !!rec.password, provider: rec.provider || 'other', address: rec.address || null, user: rec.user || null,
  imapHost: rec.imapHost || null, imapPort: rec.imapPort || null, smtpHost: rec.smtpHost || null, smtpPort: rec.smtpPort || null, smtpSecurity: rec.smtpSecurity || 'tls', hasPassword: !!rec.password });

const imapServer = rec => ({ host: rec.imapHost, port: rec.imapPort, tls: rec.tls !== false });
const smtpServer = rec => ({ host: rec.smtpHost, port: rec.smtpPort, tls: rec.tls !== false, security: rec.smtpSecurity, user: rec.user, pass: rec.password });

/** Signed in to IMAP, `work` run, signed out — whatever happens. */
async function withImap(rec, work) {
  const c = await imap.connect(imapServer(rec));
  try { await c.login(rec.user, rec.password); const out = await work(c); await c.logout(); return out; }
  catch (e) { c.close(); throw e; }
}

const draftsOf = folders => folders.find(f => f.flags.some(x => /^\\Drafts$/i.test(x)))?.name
  || folders.find(f => /^(\[gmail\]\/)?drafts$|^inbox[./]drafts$/i.test(f.name))?.name || 'Drafts';

async function test(rec) {
  const folders = await withImap(rec, c => c.list());
  await smtp.check(smtpServer(rec));
  return { summary: `signed in to ${rec.imapHost} (${folders.length} folders) and ${rec.smtpHost}`, keep: {} };
}

function def(id, rec, label) {
  return { name: `connector_${id}`, description: `Read and write mail in ${label} (${rec.address}), connected by app password: list folders, search, `
    + 'read a message, keep a draft in its Drafts folder, or send — sending is always asked of a person first.',
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['folders', 'search', 'read', 'draft', 'send'], description: 'search (default) lists messages, newest first; read opens one by uid.' },
    folder: { type: 'string', description: 'The folder (default INBOX), as folders lists it.' },
    text: { type: 'string', description: 'search: words anywhere in the message.' },
    from: { type: 'string', description: 'search: words in the sender.' },
    subject: { type: 'string', description: 'search: words in the subject; draft/send: the subject.' },
    since: { type: 'string', description: 'search: on or after this day (2026-10-01).' },
    before: { type: 'string', description: 'search: before this day.' },
    unseen: { type: 'boolean', description: 'search: only unread messages.' },
    limit: { type: 'number', description: 'search: how many (default 20, at most 100).' },
    uid: { type: 'number', description: 'read: the message\'s uid from search.' },
    to: { type: 'array', items: { type: 'string' }, description: 'draft/send: addresses.' },
    cc: { type: 'array', items: { type: 'string' }, description: 'draft/send: copies.' },
    body: { type: 'string', description: 'draft/send: the text, plain.' },
    in_reply_to: { type: 'string', description: 'draft/send: the Message-ID it answers (from read), to keep the thread.' },
  } } };
}

function message(rec, args) {
  const list = v => [].concat(v || []).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean);
  const to = list(args.to), cc = list(args.cc);
  if (!to.length) throw bad('Give at least one address in to.');
  if (to.length + cc.length > 20) throw bad('At most 20 recipients.');
  const wrong = [...to, ...cc].find(a => !ADDR.test(a));
  if (wrong) throw bad(`"${wrong}" is not an address.`);
  const subject = String(args.subject ?? '').slice(0, 300);
  return { to, cc, raw: mime.compose({ from: rec.address, to, cc, subject, text: String(args.body ?? args.text ?? '').slice(0, 200000),
    inReplyTo: args.in_reply_to ? String(args.in_reply_to).slice(0, 300) : null, domain: rec.address.split('@')[1] }), subject };
}

async function run(id, rec, args = {}) {
  const action = args.action || 'search';
  const folder = String(args.folder || 'INBOX').slice(0, 200);
  if (action === 'folders') {
    const fs = await withImap(rec, c => c.list());
    return `${fs.length} folders in ${rec.address}:\n${fs.map(f => `- ${f.name}${f.flags.filter(x => /^\\(Drafts|Sent|Trash|Junk|Archive|All|Flagged)$/i.test(x)).map(x => ` (${x.slice(1)})`).join('')}`).join('\n')}`;
  }
  if (action === 'search') {
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
    return withImap(rec, async c => {
      await c.examine(folder);
      const uids = (await c.search({ text: args.text, from: args.from, subject: args.subject, since: args.since, before: args.before, unseen: args.unseen === true })).sort((a, b) => b - a);
      const rows = (await c.headers(uids.slice(0, limit))).sort((a, b) => b.uid - a.uid);
      return [`${uids.length} message${uids.length === 1 ? '' : 's'} in ${folder}${uids.length > limit ? ` (the newest ${limit})` : ''}:`,
        ...rows.map(r => { const h = mime.summary(r.header); return `- uid ${r.uid}${r.flags.includes('\\Seen') ? '' : ' (unread)'} · ${h.date} · ${h.from} · ${h.subject || '(no subject)'}`; })].join('\n');
    });
  }
  if (action === 'read') {
    if (!Number.isInteger(Number(args.uid))) throw bad('read needs the uid search gave.');
    return withImap(rec, async c => {
      await c.examine(folder);
      const raw = await c.fetch(Number(args.uid));
      if (!raw) throw bad(`No message ${args.uid} in ${folder}.`, 404);
      const m = mime.read(raw);
      const body = m.text.length > 30000 ? `${m.text.slice(0, 30000)}\n… (${m.text.length} characters)` : m.text;
      return [`From: ${m.from}`, `To: ${m.to}`, ...(m.cc ? [`Cc: ${m.cc}`] : []), `Date: ${m.date}`, `Subject: ${m.subject}`, `Message-ID: ${m.messageId}`,
        ...(m.files.length ? [`Attachments: ${m.files.map(f => `${f.name} (${f.mime}, ${f.bytes} bytes)`).join(', ')}`] : []), '', body].join('\n');
    });
  }
  if (action === 'draft') {
    const msg = message(rec, args);
    const where = await withImap(rec, async c => { const box = draftsOf(await c.list()); await c.append(box, msg.raw); return box; });
    return `Draft kept in ${where} of ${rec.address}: "${msg.subject}" to ${msg.to.join(', ')}. Nothing was sent; the person can open it in their mail and send it, or ask you to.`;
  }
  if (action === 'send') {
    const msg = message(rec, args);
    await smtp.send(smtpServer(rec), { from: rec.address, to: [...msg.to, ...msg.cc], raw: msg.raw });
    return `Sent from ${rec.address}: "${msg.subject}" to ${[...msg.to, ...msg.cc].join(', ')}.${rec.provider === 'google' ? '' : ' (A copy may not be in the Sent folder: not every provider keeps one for mail sent this way.)'}`;
  }
  throw bad(`No action "${action}": folders, search, read, draft or send.`);
}

module.exports = { via: 'mail', label: 'Mail by app password', SECRETS, accept, view, test, def, run };
