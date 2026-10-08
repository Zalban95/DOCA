'use strict';

/**
 * Reading a mail (RFC 5322 / MIME) and writing a reply — as much as the channel needs: headers (unfolded, with
 * encoded words decoded), the plain-text part (quoted-printable or base64), attachments, and the reply's own text
 * without the quoted history under it. And `trusted()`: whether the receiving server vouched for the sender.
 */
const crypto = require('crypto');

function headers(block) {
  const out = [];
  for (const line of block.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
  }
  return out;
}
const one = (hs, name) => hs.find(([k]) => k === name)?.[1] || '';
const words = s => String(s).replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_m, _cs, enc, txt) => (enc.toLowerCase() === 'b'
  ? Buffer.from(txt, 'base64').toString('utf8') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')));
const qp = s => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
const param = (h, name) => (new RegExp(`${name}\\*?=("([^"]*)"|[^;\\s]+)`, 'i').exec(h) || [])[2] ?? (new RegExp(`${name}\\*?=([^;\\s]+)`, 'i').exec(h) || [])[1] ?? null;

function decode(body, enc) {
  const e = String(enc || '').toLowerCase();
  if (e === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  if (e === 'quoted-printable') return qp(body);
  return Buffer.from(body, 'utf8');
}

/** A part: its headers and body, and for a multipart its parts. */
function part(raw) {
  const s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  const cut = s.search(/\r?\n\r?\n/);
  const hs = headers(cut < 0 ? s : s.slice(0, cut));
  const body = cut < 0 ? '' : s.slice(cut).replace(/^\r?\n\r?\n/, '');
  const type = one(hs, 'content-type') || 'text/plain';
  const boundary = /^multipart\//i.test(type) && param(type, 'boundary');
  const parts = boundary ? body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*\\r?\\n`)).slice(1).filter(p => p.trim() && !p.startsWith('--')).map(part) : null;
  return { hs, type, body, parts };
}

function walk(p, out) {
  if (p.parts) { for (const c of p.parts) walk(c, out); return out; }
  const disp = one(p.hs, 'content-disposition');
  const name = param(disp, 'filename') || param(p.type, 'name');
  const data = decode(p.body, one(p.hs, 'content-transfer-encoding'));
  if (name || /^attachment/i.test(disp)) out.files.push({ name: words(name || 'attachment'), mime: p.type.split(';')[0].trim(), buffer: data });
  else if (/^text\/plain/i.test(p.type) && !out.text) out.text = data.toString('utf8');
  else if (/^text\/html/i.test(p.type) && !out.html) out.html = data.toString('utf8');
  return out;
}

/** The reply's own words: the quoted history under it ("On … wrote:", "> …", a signature) left out. */
function ownText(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const stop = lines.findIndex(l => /^\s*>/.test(l) || /^On .+wrote:\s*$/i.test(l) || /^-- $/.test(l) || /^-{2,}\s*Original Message/i.test(l));
  return (stop < 0 ? lines : lines.slice(0, stop)).join('\n').trim();
}

const addressOf = s => (/<([^>]+)>/.exec(s)?.[1] || String(s).trim()).toLowerCase();

function parse(raw) {
  const p = part(raw);
  const got = walk(p, { text: '', html: '', files: [] });
  const text = got.text || got.html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return { from: addressOf(one(p.hs, 'from')), fromHeader: words(one(p.hs, 'from')), subject: words(one(p.hs, 'subject')), messageId: one(p.hs, 'message-id'),
    authResults: p.hs.filter(([k]) => k === 'authentication-results').map(([, v]) => v), text: ownText(text), files: got.files, autoSubmitted: one(p.hs, 'auto-submitted') };
}

/**
 * Did the receiving server vouch for the sender? A From address is only a claim. The server that took the mail
 * (`authservId`, e.g. mx.google.com) writes Authentication-Results; trusted is dmarc=pass, or dkim=pass for the
 * From address's own domain. Only the header that server wrote counts — a sender can add one of its own; without an
 * authservId set, the topmost header (the last server's) is read.
 */
function trusted(mail, authservId) {
  const domain = mail.from.split('@')[1] || '';
  const mine = authservId ? mail.authResults.filter(h => h.split(';')[0].trim().toLowerCase() === authservId.toLowerCase()) : mail.authResults.slice(0, 1);
  return mine.some(h => /\bdmarc=pass\b/i.test(h) || new RegExp(`\\bdkim=pass\\b[^;]*header\\.(d|i)=@?([\\w.-]*\\.)?${domain.replace(/\./g, '\\.')}\\b`, 'i').test(h));
}

const encWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${Buffer.from(s).toString('base64')}?=`);
const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

/**
 * A plain-text message: From, To and Cc as plain addresses, the subject (encoded when it is not ASCII), threaded to
 * `inReplyTo` when given, the body base64 so any language travels. No header value can carry a line break, so
 * nothing written into one adds a header of its own.
 */
function compose({ from, to, cc = [], subject, inReplyTo, text, domain = 'doca.local', headers = [] }) {
  const list = v => [].concat(v || []).map(oneLine).filter(Boolean).join(', ');
  return [`From: ${oneLine(from)}`, `To: ${list(to)}`, ...(list(cc) ? [`Cc: ${list(cc)}`] : []), `Subject: ${encWord(oneLine(subject))}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${oneLine(domain)}>`,
    ...(inReplyTo ? [`In-Reply-To: ${oneLine(inReplyTo)}`, `References: ${oneLine(inReplyTo)}`] : []), ...headers.map(oneLine),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(String(text ?? '')).toString('base64').replace(/.{76}/g, '$&\r\n')].join('\r\n');
}

/** A plain-text reply, threaded to the message it answers. */
function reply({ from, to, subject, inReplyTo, text, domain = 'doca.local' }) {
  return compose({ from, to, subject: /^re:/i.test(subject || '') ? subject : `Re: ${subject || 'DOCA'}`, inReplyTo, text, domain, headers: ['Auto-Submitted: auto-replied'] });
}

/** A message as a person reads it: who, when, the whole text (quoted history kept) and the attachments by name. */
function read(raw) {
  const p = part(raw);
  const got = walk(p, { text: '', html: '', files: [] });
  const text = got.text || got.html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n');
  const h = name => words(one(p.hs, name));
  return { from: h('from'), to: h('to'), cc: h('cc'), date: h('date'), subject: h('subject'), messageId: one(p.hs, 'message-id'),
    text: text.trim(), files: got.files.map(f => ({ name: f.name, mime: f.mime, bytes: f.buffer.length })) };
}

/** The few headers a list of messages shows. */
function summary(headerBlock) {
  const hs = headers(Buffer.isBuffer(headerBlock) ? headerBlock.toString('utf8') : String(headerBlock));
  return { from: words(one(hs, 'from')), to: words(one(hs, 'to')), subject: words(one(hs, 'subject')), date: one(hs, 'date'), messageId: one(hs, 'message-id') };
}

module.exports = { parse, trusted, reply, compose, read, summary, ownText, addressOf };
