'use strict';

/** The small parts of mail every provider needs: addresses read from a header, HTML as text, a plain-text message written. */

/** "Anna Rossi <anna@example.com>" → { name, address } */
function address(text) {
  const s = String(text || '').trim();
  const m = /^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/.exec(s);
  if (m) return { name: (m[1] || '').trim(), address: m[2].trim().toLowerCase() };
  return { name: '', address: s.toLowerCase() };
}

/** A list header split at the commas that are not inside quotes. */
function addresses(text) {
  const out = [];
  let cur = '', q = false;
  for (const c of String(text || '')) { if (c === '"') q = !q; if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; }
  if (cur.trim()) out.push(cur);
  return out.map(address).filter(a => a.address);
}

const stripHtml = h => String(h || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

// A header with anything but plain ASCII is written as RFC 2047 words; a line break in one would start a new header.
const word = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const list = a => [].concat(a || []).map(x => oneLine(typeof x === 'string' ? x : x.address)).filter(Boolean).join(', ');

/** A plain-text message, base64url as Gmail's `raw` takes it. */
function build({ to, cc, subject, body, inReplyTo, references }) {
  const head = [`To: ${list(to)}`, ...(list(cc) ? [`Cc: ${list(cc)}`] : []), `Subject: ${word(oneLine(subject))}`,
    ...(inReplyTo ? [`In-Reply-To: ${oneLine(inReplyTo)}`] : []), ...(references ? [`References: ${oneLine(references)}`] : []),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  const text = `${head.join('\r\n')}\r\n\r\n${Buffer.from(String(body || ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')}`;
  return Buffer.from(text, 'utf8').toString('base64url');
}

/** Read back what build() wrote (the tests, and a check before sending). */
function parse(raw) {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const [head, ...rest] = text.split('\r\n\r\n');
  const h = {};
  for (const l of head.split('\r\n')) { const i = l.indexOf(':'); h[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
  return { headers: h, body: Buffer.from(rest.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

module.exports = { address, addresses, stripHtml, build, parse };
