'use strict';

/**
 * As much IMAP4rev1 as DOCA uses (RFC 3501), on Node's tls/net alone — the mail channel (LOGIN, SELECT, UID SEARCH
 * UNSEEN, UID FETCH, UID STORE \Seen) and the mail connector (LIST, EXAMINE, UID SEARCH by criteria, header fetches,
 * APPEND of a draft). Implicit TLS (993) unless `tls: false` (the tests' stub). Responses are read as lines, and a
 * `{n}` literal as exactly n bytes, so a message body is never cut by a line; a command can send a literal of its own
 * (a draft, a search word that is not ASCII) and waits for the server's "+" before the bytes.
 *
 * Every word that reaches a command line is quoted, and a line break in one is removed: a folder name or a search
 * word the agent gave must not end the command and start another.
 */
const net = require('net');
const tls = require('tls');
const utf7 = require('./utf7');

const clean = s => String(s ?? '').replace(/[\r\n\0]+/g, ' ');
const quote = s => `"${clean(s).replace(/["\\]/g, m => `\\${m}`)}"`;
const ascii = s => /^[\x20-\x7e]*$/.test(String(s));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A date for SEARCH SINCE / BEFORE: 8-Oct-2026. */
const imapDate = d => { const t = new Date(d); return Number.isNaN(t.getTime()) ? null : `${t.getUTCDate()}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()}`; };

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
          const restNl = buf.indexOf('\r\n', nl + 2 + n);
          if (restNl < 0) return;                 // nor the rest of its line
          const literal = buf.slice(nl + 2, nl + 2 + n);
          const rest = buf.slice(nl + 2 + n, restNl).toString('utf8');
          buf = buf.slice(restNl + 2);
          lines.push({ line: line + rest, literal });
        } else { buf = buf.slice(nl + 2); lines.push({ line }); }
        if (waiting) waiting();
      }
    };
    sock.on('data', d => { buf = Buffer.concat([buf, d]); pump(); });
    sock.on('error', e => { if (waiting) waiting(e); else reject(e); });
    sock.on('close', () => { if (waiting) waiting(new Error(`${host} closed the connection`)); });
    const next = () => new Promise((res, rej) => {
      const check = err => { if (err) { waiting = null; return rej(err); } if (lines.length) { waiting = null; res(lines.shift()); } };
      waiting = check; check();
    });
    /**
     * One command: every untagged response before its tagged OK, or a throw with the server's words. `parts` is the
     * command as strings and Buffers; each Buffer goes as a literal once the server says "+".
     */
    async function cmd(...parts) {
      const t = `A${++tag}`;
      const out = [];
      let line = `${t} `;
      for (const p of parts) {
        if (!Buffer.isBuffer(p)) { line += p; continue; }
        sock.write(`${line}{${p.length}}\r\n`);
        for (;;) {
          const r = await next();
          if (r.line.startsWith('+')) break;
          if (r.line.startsWith(`${t} `)) throw new Error(`IMAP ${String(parts[0]).split(' ')[0]}: ${r.line.slice(t.length + 1)}`);
          out.push(r);
        }
        sock.write(p);
        line = '';
      }
      sock.write(`${line}\r\n`);
      for (;;) {
        const r = await next();
        if (r.line.startsWith(`${t} `)) {
          if (!/^\S+ OK/i.test(r.line)) throw new Error(`IMAP ${String(parts[0]).split(' ')[0]}: ${r.line.slice(t.length + 1)}`);
          return out;
        }
        out.push(r);
      }
    }
    /** A word for a command: quoted when ASCII, else a literal (with CHARSET UTF-8 on the search). */
    const word = s => (ascii(clean(s)) ? [quote(s)] : [Buffer.from(clean(s), 'utf8')]);
    const box = name => quote(utf7.encode(name));

    /** SEARCH criteria from { text, from, to, subject, since, before, unseen } → command parts. */
    function criteria(c = {}) {
      const parts = [];
      const add = (key, v) => { if (v !== undefined && v !== null && String(v).trim()) parts.push(` ${key} `, ...word(String(v).trim())); };
      add('TEXT', c.text); add('FROM', c.from); add('TO', c.to); add('SUBJECT', c.subject);
      const since = c.since && imapDate(c.since), before = c.before && imapDate(c.before);
      if (since) parts.push(` SINCE ${since}`);
      if (before) parts.push(` BEFORE ${before}`);
      if (c.unseen) parts.push(' UNSEEN');
      return parts.length ? parts : [' ALL'];
    }
    const uidsOf = rs => rs.flatMap(r => (/^\* SEARCH ?(.*)$/i.exec(r.line)?.[1] || '').trim().split(/\s+/).filter(Boolean).map(Number)).filter(Number.isFinite);

    next().then(greet => {
      if (!/^\* (OK|PREAUTH)/i.test(greet.line)) return reject(new Error(`IMAP greeting: ${greet.line}`));
      resolve({
        login: (user, pass) => cmd(`LOGIN ${quote(user)} ${quote(pass)}`),
        select: (name = 'INBOX') => cmd(`SELECT ${box(name)}`),
        /** Open a folder read-only: reading it changes no flag. */
        examine: (name = 'INBOX') => cmd(`EXAMINE ${box(name)}`),
        unseen: async () => uidsOf(await cmd('UID SEARCH UNSEEN')),
        search: async c => {
          const parts = criteria(c);
          return uidsOf(await cmd(parts.some(Buffer.isBuffer) ? 'UID SEARCH CHARSET UTF-8' : 'UID SEARCH', ...parts));
        },
        /** Every folder: { name, flags, delimiter }. */
        list: async () => (await cmd('LIST "" "*"')).map(r => {
          const m = /^\* LIST \(([^)]*)\) (NIL|"(?:[^"\\]|\\.)*"|\S+) ?(.*)$/i.exec(r.line);
          if (!m) return null;
          const raw = r.literal ? r.literal.toString('utf8') : m[3].replace(/^"(.*)"$/, '$1').replace(/\\(["\\])/g, '$1');
          return { name: utf7.decode(raw), flags: m[1].split(/\s+/).filter(Boolean), delimiter: m[2] === 'NIL' ? null : m[2].replace(/^"|"$/g, '') };
        }).filter(Boolean),
        fetch: async uid => (await cmd(`UID FETCH ${Number(uid)} (BODY.PEEK[])`)).find(r => r.literal)?.literal || null,
        /** The headers that make a list of messages, for these uids. */
        headers: async uids => (uids.length ? (await cmd(`UID FETCH ${uids.map(Number).join(',')} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])`)) : [])
          .filter(r => r.literal).map(r => ({ uid: Number(/\bUID (\d+)/i.exec(r.line)?.[1]), flags: (/\bFLAGS \(([^)]*)\)/i.exec(r.line)?.[1] || '').split(/\s+/).filter(Boolean),
            size: Number(/\bRFC822\.SIZE (\d+)/i.exec(r.line)?.[1]) || null, header: r.literal })),
        seen: uid => cmd(`UID STORE ${Number(uid)} +FLAGS (\\Seen)`),
        /** Keep a message in a folder (a draft): the bytes go as a literal. */
        append: (name, raw, flags = ['\\Draft', '\\Seen']) => cmd(`APPEND ${box(name)} (${flags.join(' ')}) `, Buffer.from(String(raw).replace(/\r?\n/g, '\r\n'))),
        logout: async () => { try { await cmd('LOGOUT'); } catch { /* closing anyway */ } sock.end(); },
        close: () => sock.destroy(),
      });
    }, reject);
  });
}

module.exports = { connect, imapDate };
