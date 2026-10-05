'use strict';

/**
 * As much SMTP as the mail channel uses (RFC 5321, AUTH PLAIN of RFC 4954), on Node's tls/net alone: implicit TLS
 * (465) unless `tls: false` (the tests' stub). One connection per message — the channel sends a few a day.
 */
const net = require('net');
const tls = require('tls');

function send({ host, port = 465, tls: secure = true, user, pass, timeoutMs = 30000 }, { from, to, raw }) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error(`no answer from ${host}:${port}`)));
    let buf = '';
    const replies = [];
    let waiting = null;
    sock.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        if (/^\d{3} /.test(line)) { replies.push(line); if (waiting) waiting(); }   // the last line of a reply
      }
    });
    sock.on('error', e => { if (waiting) waiting(e); else reject(e); });
    const reply = () => new Promise((res, rej) => { const check = e => { if (e) return rej(e); if (replies.length) { waiting = null; res(replies.shift()); } }; waiting = check; check(); });
    const step = async (line, ok) => {
      if (line !== null) sock.write(`${line}\r\n`);
      const r = await reply();
      if (!ok.test(r)) throw new Error(`SMTP ${line === null ? 'greeting' : line.split(' ')[0]}: ${r}`);
      return r;
    };
    (async () => {
      await step(null, /^220/);
      await step('EHLO doca', /^250/);
      if (user) await step(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, /^235/);
      await step(`MAIL FROM:<${from}>`, /^250/);
      await step(`RCPT TO:<${to}>`, /^25[01]/);
      await step('DATA', /^354/);
      // Dot-stuffing: a line that begins with "." gets another.
      await step(`${String(raw).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')}\r\n.`, /^250/);
      await step('QUIT', /^221/).catch(() => {});
      sock.end();
    })().then(resolve, e => { sock.destroy(); reject(e); });
  });
}

module.exports = { send };
