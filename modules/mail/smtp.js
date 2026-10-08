'use strict';

/**
 * As much SMTP as DOCA uses (RFC 5321, AUTH PLAIN of RFC 4954, STARTTLS of RFC 3207), on Node's tls/net alone:
 * implicit TLS (465) by default, STARTTLS (587: iCloud, Outlook) with `security: 'starttls'`, or plain with
 * `tls: false` (the tests' stub). One connection per message — mail is sent a few times a day. `check()` signs in and
 * leaves without sending, which is how a connection is tested on save.
 */
const net = require('net');
const tls = require('tls');

function session({ host, port = 465, tls: secure = true, security, user, pass, timeoutMs = 30000 }, work) {
  const starttls = secure && security === 'starttls';
  return new Promise((resolve, reject) => {
    let sock = secure && !starttls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '', waiting = null;
    const replies = [];
    const onData = d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        if (/^\d{3} /.test(line)) { replies.push(line); if (waiting) waiting(); }   // the last line of a reply
      }
    };
    const onError = e => { if (waiting) waiting(e); else reject(e); };
    const wire = s => { s.setTimeout(timeoutMs, () => s.destroy(new Error(`no answer from ${host}:${port}`))); s.on('data', onData); s.on('error', onError); };
    wire(sock);
    const reply = () => new Promise((res, rej) => { const check = e => { if (e) return rej(e); if (replies.length) { waiting = null; res(replies.shift()); } }; waiting = check; check(); });
    const step = async (line, ok, what) => {
      if (line !== null) sock.write(`${line}\r\n`);
      const r = await reply();
      // The server's words, never the line sent: AUTH carries the password.
      if (!ok.test(r)) throw new Error(`SMTP ${what || (line === null ? 'greeting' : line.split(' ')[0])}: ${r}`);
      return r;
    };
    (async () => {
      await step(null, /^220/);
      await step('EHLO doca', /^250/);
      if (starttls) {
        await step('STARTTLS', /^220/);
        sock.removeListener('data', onData);
        sock = tls.connect({ socket: sock, servername: host });
        wire(sock);
        await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
        await step('EHLO doca', /^250/);
      }
      if (user) await step(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, /^235/, 'sign-in');
      await work(step);
      await step('QUIT', /^221/).catch(() => {});
      sock.end();
    })().then(resolve, e => { sock.destroy(); reject(e); });
  });
}

/** Send one message to every recipient in `to` (a string or a list). */
function send(server, { from, to, raw }) {
  return session(server, async step => {
    await step(`MAIL FROM:<${from}>`, /^250/);
    for (const rcpt of [].concat(to)) await step(`RCPT TO:<${rcpt}>`, /^25[01]/);
    await step('DATA', /^354/);
    // Dot-stuffing: a line that begins with "." gets another.
    await step(`${String(raw).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')}\r\n.`, /^250/, 'DATA');
  });
}

/** Sign in and leave: whether this server takes these details. */
const check = server => session(server, async () => {});

module.exports = { send, check };
