'use strict';

// Connecting without an OAuth app (modules/connectors/ways): a calendar by its secret address (a stub serving an ICS),
// a mailbox by app password (the stub IMAP and SMTP servers), each tested on save, each the tool connector_<id> under
// the connector's rules; sending is always asked; the address and the password never leave the vault — not to a
// browser, not into the transcript, the logs or any other file of the hub.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const H = require('./helpers');

const SECRET_PATH = '/private-7f3a9c1e2b/basic.ics';
const PASSWORD = 'pw';   // the stubs' password: checked below as the AUTH and LOGIN value, never echoed
let ics, stubs, icsBody, icsStatus = 200;
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

before(async () => {
  const today = new Date();
  const at = h => `${ymd(today)}T${String(h).padStart(2, '0')}0000`;
  icsBody = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Family', `X-WR-TIMEZONE:${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Piano lesson', `DTSTART:${at(17)}`, `DTEND:${at(18)}`, 'LOCATION:Music school', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Bins out', `DTSTART;VALUE=DATE:${ymd(today)}`, 'RRULE:FREQ=WEEKLY', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  ics = http.createServer((req, res) => {
    if (req.url !== SECRET_PATH) { res.writeHead(404); return res.end('no'); }
    res.writeHead(icsStatus, { 'Content-Type': 'text/calendar' }); res.end(icsStatus === 200 ? icsBody : 'gone');
  });
  await new Promise(r => ics.listen(0, '127.0.0.1', r));
  stubs = await require('./fixtures/mail-stubs').start();
  await H.start();
});
after(async () => { await H.stop(); await new Promise(r => ics.close(r)); await stubs.close(); });

const address = () => `http://127.0.0.1:${ics.address().port}${SECRET_PATH}`;
const mailbox = (extra = {}) => ({ via: 'mail', address: 'doca@hive.test', password: PASSWORD, imapHost: '127.0.0.1', imapPort: stubs.imapPort,
  smtpHost: '127.0.0.1', smtpPort: stubs.smtpPort, tls: false, ...extra });

test('a calendar by its secret address: tested on save, the address never read back, a tool for today and a range', async () => {
  const r = await H.api(null, 'POST', '/api/connectors/google-calendar', { address: address() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.test.ok, r.body.connector.connected, r.body.connector.calendar], [true, true, 'Family']);
  assert.match(r.body.test.summary, /"Family", 2 events read/);
  const all = JSON.stringify((await H.api(null, 'GET', '/api/connectors')).body);
  assert.ok(!all.includes('private-7f3a9c1e2b'), 'the address is never sent back');
  const way = (await H.api(null, 'GET', '/api/connectors')).body.services.find(s => s.id === 'google').ways;
  assert.deepEqual(way.map(x => x.via), ['ics', 'mail', 'oauth'], 'simplest first');
  assert.equal(way[0].state.host, `127.0.0.1:${ics.address().port}`, 'the host only');
  const tools = require('../modules/harness/tools');
  assert.ok(tools.schemas().some(t => t.function.name === 'connector_google-calendar'));
  const today = await tools.call('connector_google-calendar', { action: 'today' });
  assert.match(today, /Piano lesson @ Music school/);
  assert.match(today, /Bins out/);
  assert.match(today, /^⟦/, 'framed as other people\'s words');
  const weeks = await tools.call('connector_google-calendar', { action: 'events', days: 15, query: 'bins' });
  assert.equal((weeks.match(/Bins out/g) || []).length, 3, 'a weekly event, three times in fifteen days');
  assert.ok(!weeks.includes('Piano'), 'the query narrows');
  const ambient = await require('../modules/ambient/calendar').today(null);
  assert.ok(ambient.events.some(e => e.title === 'Piano lesson'), 'today\'s plan on the ambient screen');
  const member = { id: 'u_m', role: 'member' };
  assert.match(await tools.call('connector_google-calendar', {}, [], { user: member }), /for people who hold host/);
});

test('a calendar address that stops working says so without the address, and is no longer a tool', async () => {
  icsStatus = 404;
  require('../modules/connectors/ways').get('ics').forget('google-calendar');
  const t = await H.api(null, 'POST', '/api/connectors/google-calendar/test');
  assert.equal(t.body.test.ok, false);
  assert.match(t.body.test.error, /answered 404.*reset or unpublished/);
  assert.ok(!JSON.stringify(t.body).includes('private-7f3a9c1e2b'));
  assert.ok(!require('../modules/harness/tools').schemas().some(x => x.function.name === 'connector_google-calendar'));
  icsStatus = 200;
  assert.equal((await H.api(null, 'POST', '/api/connectors/google-calendar/test')).body.test.ok, true);
  assert.equal((await H.api(null, 'POST', '/api/connectors/google-calendar', { address: 'ftp://nope' })).status, 400);
  assert.equal(require('../modules/connectors/ways').get('ics').accept({ address: 'webcal://p01-calendars.icloud.com/published/2/abc' }).address,
    'https://p01-calendars.icloud.com/published/2/abc', 'webcal:// is fetched over https');
});

test('a mailbox by app password: tested on save; folders, search, read and a draft; plain text only to this machine', async () => {
  const wrong = await H.api(null, 'POST', '/api/connectors/home-mail', mailbox({ password: 'not-it' }));
  assert.equal(wrong.status, 200);
  assert.equal(wrong.body.test.ok, false);
  assert.match(wrong.body.test.error, /IMAP LOGIN: NO bad password/);
  assert.ok(!JSON.stringify(wrong.body).includes('not-it'));
  const ok = await H.api(null, 'POST', '/api/connectors/home-mail', mailbox());
  assert.equal(ok.body.test.ok, true, JSON.stringify(ok.body));
  assert.match(ok.body.test.summary, /signed in to 127\.0\.0\.1 \(4 folders\)/);
  assert.equal(ok.body.connector.hasPassword, true);
  assert.ok(!JSON.stringify((await H.api(null, 'GET', '/api/connectors')).body).includes(`"${PASSWORD}"`), 'the password is never sent back');
  assert.equal((await H.api(null, 'POST', '/api/connectors/far-mail', mailbox({ imapHost: 'imap.example.com', smtpHost: 'smtp.example.com' }))).status, 400, 'no TLS only to this machine');
  assert.equal((await H.api(null, 'POST', '/api/connectors/google', { via: 'mail' })).status, 200, 'an OAuth id stays OAuth');
  stubs.mail({ from: 'Mum <mum@home.test>', subject: 'Sunday lunch', body: 'Come at one? Bring the cake.' });
  stubs.mail({ from: 'Shop <news@shop.test>', subject: 'Offers', body: 'Buy now' });
  const tools = require('../modules/harness/tools');
  assert.match(await tools.call('connector_home-mail', { action: 'folders' }), /- Drafts \(Drafts\)[\s\S]*- Entwürfe/);
  const found = await tools.call('connector_home-mail', { action: 'search', from: 'mum' });
  assert.match(found, /1 message in INBOX/);
  const uid = Number(/uid (\d+)/.exec(found)[1]);
  const read = await tools.call('connector_home-mail', { action: 'read', uid });
  assert.match(read, /Subject: Sunday lunch[\s\S]*Bring the cake/);
  assert.match(read, /^⟦/, 'framed');
  const lunch = stubs.box.find(m => m.uid === uid);
  assert.equal(lunch.seen, false, 'reading does not mark it read (EXAMINE, BODY.PEEK)');
  const draft = await tools.call('connector_home-mail', { action: 'draft', to: ['mum@home.test'], subject: 'Re: Sunday lunch', body: 'Yes — torta di mele.', in_reply_to: '<m1@home.test>' });
  assert.match(draft, /Draft kept in Drafts/);
  assert.match(stubs.folders.Drafts.at(-1).raw, /^In-Reply-To: <m1@home\.test>$/m);
  assert.equal(stubs.sent.length, 0, 'a draft sends nothing');
  assert.match(await tools.call('connector_home-mail', { action: 'draft', to: ['mum@home.test\r\nBcc: x@evil.test'] }), /is not an address/, 'no header smuggled in');
  assert.match(await tools.call('connector_home-mail', { action: 'search', text: 'torta\r\nA1 LOGOUT' }), /0 messages/, 'a line break in a search word is not a command');
});

test('sending is always asked — in every mode, never "always"; risk tiers call it outward', async () => {
  const approval = require('../modules/harness/approval');
  const g = approval.gate('connector_home-mail', { action: 'send', to: ['mum@home.test'], subject: 'Hi' });
  assert.deepEqual([g?.forced, g?.keys], [true, null]);
  assert.match(g.summary, /Send mail from home-mail to mum@home\.test: "Hi"\. Always asked/);
  assert.equal(approval.gate('connector_dav', { action: 'create_event', title: 'x' })?.forced, true, 'a CalDAV event too');
  assert.equal(require('../modules/harness/forced-asks').of('connector_home-mail', { action: 'search' }, () => ''), null, 'reading is not forced');
  const classify = require('../modules/harness/risk/classify');
  assert.equal(classify.classify('connector_home-mail', { action: 'send' }).tier, 'outward');
  assert.equal(classify.classify('connector_home-mail', { action: 'draft' }).tier, 'reversible');
  assert.equal(classify.classify('connector_home-mail', { action: 'read' }).tier, 'read');
});

test('a real turn sends after the person says yes — and the address and password are in no transcript, log or other file', async () => {
  const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };
  const call = (id, name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const tools = (JSON.parse(raw || '{}').messages || []).filter(m => m.role === 'tool').length;
      if (tools === 0) return sse([call('c1', 'connector_google-calendar', { action: 'today' })])(res);
      if (tools === 1) return sse([call('c2', 'connector_home-mail', { action: 'send', to: ['mum@home.test'], subject: 'Lunch', body: 'See you at one.' })])(res);
      return sse([{ choices: [{ delta: { content: 'Sent.' } }] }])(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { cstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
    require('../modules/harness/catalog').saveConfig('doca', { provider: 'cstub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
    const memory = require('../modules/harness/memory'), approval = require('../modules/harness/approval');
    const s = memory.createSession('conn-ways', { activate: false });
    let asked = null;
    const answering = (async () => { for (let i = 0; i < 300 && !asked; i++) { await H.sleep(25); asked = approval.pending().find(p => p.tool === 'connector_home-mail'); } if (asked) approval.decide(asked.id, 'once'); })();
    const r = await require('../modules/harness/agent').turn({ message: 'Check today and tell Mum I will come.', sessionId: s.id, emit: () => {} });
    await answering;
    assert.ok(asked, 'the person was asked before it was sent');
    assert.match(r.text, /Sent\./);
    const out = stubs.sent.at(-1);
    assert.deepEqual([out.rcpts, out.auth], [['mum@home.test'], PASSWORD]);
    assert.match(out.raw, /^Subject: Lunch$/m);
    const rows = JSON.stringify(memory.messages(s.id));
    assert.match(rows, /Piano lesson/);
    for (const secret of ['private-7f3a9c1e2b', `"${PASSWORD}"`]) {
      assert.ok(!rows.includes(secret), `${secret} is not in the transcript`);
      assert.ok(!JSON.stringify(require('../modules/logs')._ring).includes(secret), `${secret} is not in the logs`);
    }
    const vault = require('../modules/paths').CONNECTOR_KEYS_FILE;
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hits = walk(process.env.DOCA_DATA_DIR).filter(f => f !== vault && fs.readFileSync(f).includes(Buffer.from('private-7f3a9c1e2b')));
    assert.deepEqual(hits, [], 'the address is in no file but the vault');
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('disconnecting forgets the secret and removes the tool; the rest of the setup stays', async () => {
  await H.api(null, 'DELETE', '/api/connectors/home-mail');
  const rec = require('../modules/connectors/vault').get('home-mail');
  assert.equal(rec.password, undefined);
  assert.equal(rec.imapHost, '127.0.0.1');
  assert.ok(!require('../modules/harness/tools').schemas().some(t => t.function.name === 'connector_home-mail'));
});
