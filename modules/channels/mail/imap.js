'use strict';

/**
 * As much IMAP4rev1 as the mail channel uses (RFC 3501), on Node's tls/net alone: LOGIN, SELECT, UID SEARCH UNSEEN,
 * UID FETCH BODY.PEEK[], UID STORE +FLAGS \Seen, LOGOUT. Implicit TLS (993) unless `tls: false` (the tests' stub).
 * Responses are read as lines, and a `{n}` literal as exactly n bytes, so a message body is never cut by a line.
 */
const net = require('net');
const tls = require('tls');

function connect({ host, port = 993, tls: secure = true, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error(`no answer from ${host}:${port}`)));
    let buf = Buffer.alloc(0), waiting = null, tag = 0;
    const lines = [];   // parsed responses: { line, literal? }
    const pump = () => {
      while (true) {
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl).toString('utf8');
        const lit = /\{(\d+)\}$/.exec(line);
        if (lit) {
          const n = Number(lit[1]);
          if (buf.length < nl + 2 + n) return;   // the literal has not all arrived
          const literal = buf.slice(nl + 2, nl + 2 + n);
          buf = buf.slice(nl + 2 + n);
          const restNl = buf.indexOf('\r\n');
          const rest = restNl >= 0 ? buf.slice(0, restNl).toString('utf8') : '';
          buf = restNl >= 0 ? buf.slice(restNl + 2) : buf;
          lines.push({ line: line + rest, literal });
        } else { buf = buf.slice(nl + 2); lines.push({ line }); }
        if (waiting) waiting();
      }
    };
    sock.on('data', d => { buf = Buffer.concat([buf, d]); pump(); });
    sock.on('error', e => { if (waiting) waiting(e); else reject(e); });
    const next = () => new Promise((res, rej) => {
      const check = err => { if (err) { waiting = null; return rej(err); } if (lines.length) { waiting = null; res(lines.shift()); } };
      waiting = check; check();
    });
    /** One command: every untagged response before its tagged OK, or a throw with the server's words. */
    async function cmd(text) {
      const t = `A${++tag}`;
      sock.write(`${t} ${text}\r\n`);
      const out = [];
      for (;;) {
        const r = await next();
        if (r.line.startsWith(`${t} `)) {
          if (!/^\S+ OK/i.test(r.line)) throw new Error(`IMAP ${text.split(' ')[0]}: ${r.line.slice(t.length + 1)}`);
          return out;
        }
        out.push(r);
      }
    }
    const quote = s => `"${String(s).replace(/["\\]/g, m => `\\${m}`)}"`;
    next().then(greet => {
      if (!/^\* (OK|PREAUTH)/i.test(greet.line)) return reject(new Error(`IMAP greeting: ${greet.line}`));
      resolve({
        login: (user, pass) => cmd(`LOGIN ${quote(user)} ${quote(pass)}`),
        select: (box = 'INBOX') => cmd(`SELECT ${quote(box)}`),
        unseen: async () => (await cmd('UID SEARCH UNSEEN')).flatMap(r => (/^\* SEARCH ?(.*)$/i.exec(r.line)?.[1] || '').split(' ').filter(Boolean).map(Number)),
        fetch: async uid => (await cmd(`UID FETCH ${uid} (BODY.PEEK[])`)).find(r => r.literal)?.literal || null,
        seen: uid => cmd(`UID STORE ${uid} +FLAGS (\\Seen)`),
        logout: async () => { try { await cmd('LOGOUT'); } catch { /* closing anyway */ } sock.end(); },
        close: () => sock.destroy(),
      });
    }, reject);
  });
}

module.exports = { connect };
