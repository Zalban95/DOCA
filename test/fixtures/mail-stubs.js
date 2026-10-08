'use strict';

// Stub IMAP and SMTP servers on local ports, plain (no TLS), for the mail channel's and the mail connector's tests:
// LOGIN (the password "pw"), LIST, SELECT/EXAMINE, UID SEARCH (UNSEEN, ALL, TEXT/FROM/SUBJECT, a literal with CHARSET
// UTF-8), UID FETCH of a whole message or its headers, UID STORE \Seen, APPEND with a literal, LOGOUT; and an SMTP
// that takes EHLO, AUTH PLAIN, MAIL, any number of RCPT, DATA and QUIT. Bytes are read as latin1 so a literal's
// length counts bytes, as IMAP's does.

const net = require('node:net');

async function start() {
  const folders = { INBOX: [], Drafts: [], Sent: [] };
  const box = folders.INBOX;
  const sent = [];
  const logins = [];
  let uid = 0;
  const mail = ({ from = 'Al <al@home.test>', subject = 'hello', body = 'hi', auth = 'mx.hive.test; dmarc=pass header.from=home.test', extra = '' } = {}) => {
    box.push({ uid: ++uid, seen: false, raw: `${auth ? `Authentication-Results: ${auth}\r\n` : ''}${extra}From: ${from}\r\nTo: doca@hive.test\r\nSubject: ${subject}\r\nDate: Thu, 8 Oct 2026 09:0${uid % 10}:00 +0000\r\nMessage-ID: <m${uid}@home.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n` });
  };
  const utf8 = s => Buffer.from(s, 'latin1').toString('utf8');

  const imap = net.createServer(sock => {
    sock.setEncoding('latin1');
    sock.write('* OK stub IMAP\r\n');
    let buf = '', pending = '', need = 0, current = 'INBOX';
    const send = s => sock.write(Buffer.from(s, 'utf8'));
    const run = line => {
      const sp = line.indexOf(' ');
      const tag = line.slice(0, sp), cmd = line.slice(sp + 1);
      const list = folders[current] || [];
      if (/^LOGIN/.test(cmd)) { logins.push(cmd); sock.write(cmd.includes('"pw"') ? `${tag} OK logged in\r\n` : `${tag} NO bad password\r\n`); }
      else if (/^LIST/.test(cmd)) send(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Drafts) "/" "Drafts"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n* LIST (\\HasNoChildren) "/" "Entw&APw-rfe"\r\n${tag} OK\r\n`);
      else if (/^(SELECT|EXAMINE) "([^"]*)"/.test(cmd)) { current = /"([^"]*)"/.exec(cmd)[1]; sock.write(folders[current] ? `* ${folders[current].length} EXISTS\r\n${tag} OK selected\r\n` : `${tag} NO no such folder\r\n`); }
      else if (/^UID SEARCH/.test(cmd)) {
        const words = [...cmd.matchAll(/\b(TEXT|FROM|SUBJECT) "([^"]*)"|\b(TEXT|FROM|SUBJECT) \u0000(.*?)\u0000/g)].map(m => [m[1] || m[3], utf8(m[2] ?? m[4]).toLowerCase()]);
        const hits = list.filter(m => (!/UNSEEN/.test(cmd) || !m.seen) && words.every(([k, v]) => {
          const raw = m.raw.toLowerCase();
          const head = k === 'FROM' ? /^from: (.*)$/im.exec(raw)?.[1] : k === 'SUBJECT' ? /^subject: (.*)$/im.exec(raw)?.[1] : raw;
          return (head || '').includes(v);
        }));
        sock.write(`* SEARCH ${hits.map(m => m.uid).join(' ')}\r\n${tag} OK\r\n`);
      } else if (/^UID FETCH ([\d,]+) \(BODY\.PEEK\[\]\)/.test(cmd)) {
        const m = list.find(x => x.uid === Number(/FETCH (\d+)/.exec(cmd)[1]));
        if (!m) return sock.write(`${tag} OK\r\n`);
        const b = Buffer.from(m.raw);
        sock.write(`* 1 FETCH (UID ${m.uid} BODY[] {${b.length}}\r\n`); sock.write(b); sock.write(`)\r\n${tag} OK\r\n`);
      } else if (/^UID FETCH ([\d,]+) \(UID FLAGS/.test(cmd)) {
        for (const id of /FETCH ([\d,]+)/.exec(cmd)[1].split(',').map(Number)) {
          const m = list.find(x => x.uid === id);
          if (!m) continue;
          const head = Buffer.from(`${m.raw.split('\r\n\r\n')[0].split('\r\n').filter(l => /^(from|to|subject|date|message-id):/i.test(l)).join('\r\n')}\r\n\r\n`);
          sock.write(`* ${id} FETCH (UID ${m.uid} FLAGS (${m.seen ? '\\Seen' : ''}) RFC822.SIZE ${m.raw.length} BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)] {${head.length}}\r\n`); sock.write(head); sock.write(')\r\n');
        }
        sock.write(`${tag} OK\r\n`);
      } else if (/^UID STORE (\d+)/.test(cmd)) { list.find(x => x.uid === Number(/(\d+)/.exec(cmd)[1])).seen = true; sock.write(`${tag} OK\r\n`); }
      else if (/^APPEND "([^"]*)"/.test(cmd)) {
        const name = /^APPEND "([^"]*)"/.exec(cmd)[1];
        if (!folders[name]) return sock.write(`${tag} NO no such folder\r\n`);
        folders[name].push({ uid: ++uid, seen: true, raw: utf8(/\u0000([\s\S]*)\u0000/.exec(cmd)[1]) });
        sock.write(`${tag} OK appended\r\n`);
      } else if (/^LOGOUT/.test(cmd)) { sock.write(`* BYE\r\n${tag} OK\r\n`); sock.end(); }
      else sock.write(`${tag} BAD unknown\r\n`);
    };
    sock.on('data', d => {
      buf += d;
      for (;;) {
        if (need) {
          if (buf.length < need) return;
          pending += `\u0000${buf.slice(0, need)}\u0000`; buf = buf.slice(need); need = 0;
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        const lit = /\{(\d+)\}$/.exec(line);
        if (lit) { pending += line.slice(0, lit.index); need = Number(lit[1]); sock.write('+ go on\r\n'); continue; }
        const whole = pending + line; pending = '';
        run(whole);
      }
    });
  });

  const smtp = net.createServer(sock => {
    sock.write('220 stub SMTP\r\n');
    let buf = '', data = false, msg = { rcpt: null, rcpts: [], auth: null };
    sock.on('data', d => {
      buf += d;
      if (data) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end < 0) return;
        sent.push({ ...msg, raw: buf.slice(0, end) }); buf = buf.slice(end + 5); data = false; msg = { rcpt: null, rcpts: [], auth: msg.auth }; sock.write('250 queued\r\n');
      }
      let nl;
      while (!data && (nl = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        if (/^EHLO/.test(line)) sock.write('250-stub\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) { msg.auth = Buffer.from(line.slice(11), 'base64').toString().split('\0')[2]; sock.write(msg.auth === 'pw' ? '235 ok\r\n' : '535 bad credentials\r\n'); }
        else if (/^MAIL FROM/.test(line)) sock.write('250 ok\r\n');
        else if (/^RCPT TO:<(.+)>/.test(line)) { msg.rcpt = msg.rcpt || /<(.+)>/.exec(line)[1]; msg.rcpts.push(/<(.+)>/.exec(line)[1]); sock.write('250 ok\r\n'); }
        else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  });
  await new Promise(r => imap.listen(0, '127.0.0.1', r));
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  return { imap, smtp, box, folders, sent, logins, mail, imapPort: imap.address().port, smtpPort: smtp.address().port,
    close: async () => { for (const s of [imap, smtp]) await new Promise(r => s.close(r)); } };
}

module.exports = { start };
