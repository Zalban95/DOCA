'use strict';

// Mail as a channel (modules/channels/mail): stub IMAP and SMTP servers on local ports, and the scripted model. A
// mail counts only when the receiving server vouched for its sender; a code links an address; a mail is a turn and
// the answer a reply in the thread; a question is answered by replying with its number.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let stubs, modelServer, script = [];
let box, sent, mail;
const lastSent = () => sent.at(-1);
const textOf = raw => { const b64 = raw.split('\r\n\r\n').slice(1).join('').replace(/\s+/g, ''); return Buffer.from(b64, 'base64').toString('utf8'); };
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  stubs = await require('./fixtures/mail-stubs').start();
  ({ box, sent, mail } = stubs);
  modelServer = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => { const next = script.shift() || { text: '(script exhausted)' }; next.seen?.(JSON.parse(raw || '{}')); sse([{ choices: [{ delta: { content: next.text } }] }])(res); });
  });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});

after(async () => {
  require('../modules/channels/mail').stop();
  await H.stop();
  await stubs.close();
  await new Promise(r => modelServer.close(r));
});

const poll = () => require('../modules/channels/mail').poll();
const waitSent = async (n, ms = 8000) => { const t = Date.now(); while (sent.length < n) { if (Date.now() - t > ms) throw new Error(`only ${sent.length} sent`); await new Promise(r => setTimeout(r, 30)); } return sent[n - 1]; };

test('a host sets up the mailbox; the password never reads back', async () => {
  const r = await H.api(null, 'POST', '/api/channels/mail', { imapHost: '127.0.0.1', imapPort: stubs.imapPort, smtpHost: '127.0.0.1', smtpPort: stubs.smtpPort,
    tls: false, user: 'doca@hive.test', password: 'pw', address: 'doca@hive.test', authservId: 'mx.hive.test', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.running, true);
  assert.equal(r.body.error, null, 'it logged in and read the empty box');
  assert.ok(!JSON.stringify((await H.api(null, 'GET', '/api/prefs')).body).includes('"pw"'), 'masked like every secret');
  assert.equal((await H.api(null, 'POST', '/api/channels/mail', { imapHost: 'bad host!' })).status, 400);
});

test('a mail its server did not vouch for is not answered — a forged From is not the owner', async () => {
  const code = (await H.api(null, 'POST', '/api/channels/mail/link')).body.code;
  mail({ subject: `link ${code}`, auth: null });
  mail({ subject: `link ${code}`, auth: 'evil.example; dmarc=pass header.from=home.test' });   // a header the sender wrote itself
  mail({ from: 'Al <al@home.test>', subject: `link ${code}`, auth: 'mx.hive.test; dkim=pass header.d=other.test; dmarc=fail' });
  await poll();
  assert.equal(sent.length, 0);
  assert.match(require('../modules/channels/mail').status().error, /did not vouch/);
  assert.ok(box.every(m => m.seen), 'read once, not again');
});

test('a vouched mail with the code links the address; a mail is then a turn, answered in the thread', async () => {
  const code = (await H.api(null, 'POST', '/api/channels/mail/link')).body.code;
  mail({ subject: `link ${code}`, body: '' });
  await poll();
  const linked = await waitSent(1);
  assert.equal(linked.rcpt, 'al@home.test');
  assert.match(textOf(linked.raw), /^Linked to owner/);
  let prompt = '';
  script = [{ text: 'Four containers are running.', seen: b => { prompt = b.messages.find(m => m.role === 'system').content; } }];
  mail({ subject: 'Containers?', body: 'How many containers are running?\n\nOn Mon, Al wrote:\n> an older question' });
  await poll();
  const answer = await waitSent(2);
  assert.equal(textOf(answer.raw), 'Four containers are running.');
  assert.match(answer.raw, /^Subject: Re: Containers\?$/m);
  assert.match(answer.raw, /^In-Reply-To: <m\d+@home\.test>$/m, 'in the thread');
  assert.match(answer.raw, /^Auto-Submitted: auto-replied$/m);
  assert.match(prompt, /mail/, 'the agent is told it is a mail');
  const turnText = JSON.stringify(require('../modules/harness/memory').messages(require('../modules/channels/mail').links.chat('al@home.test').sessionId));
  assert.ok(!turnText.includes('an older question'), 'the quoted history is not part of the message');
});

test('a question arrives numbered and a reply with the number answers it; automatic mail is ignored', async () => {
  const dev = require('../modules/api-v1/devices').list().find(d => d.kind === 'channel' && /Mail/.test(d.name));
  const asked = require('../modules/harness/reach').ask({ to: dev.id, question: 'Deploy now?', choices: ['Yes', 'No'], timeoutSec: 20 });
  const q = await waitSent(3);
  assert.match(textOf(q.raw), /1\. Yes\n2\. No\n3\. Not now\n\nReply with the number\./);
  mail({ subject: 'Re: Deploy now?', body: '1\n\nOn Tue, DOCA wrote:\n> Deploy now?' });
  await poll();
  assert.match(JSON.stringify(await asked), /Yes/);
  await waitSent(4);
  const n = sent.length;
  mail({ subject: 'Out of office', body: 'I am away', extra: 'Auto-Submitted: auto-replied\r\n' });
  await poll();
  await new Promise(r => setTimeout(r, 200));
  assert.equal(sent.length, n, 'an auto-reply gets no answer: no mail loops');
});
