'use strict';

// Calendars and contacts by CalDAV and CardDAV with an app password (modules/calendar/dav.js, connectors/ways/dav.js):
// a stub server that discovers the way iCloud and Fastmail do (well-known → principal → home → collections), answers
// calendar and contacts queries with its own namespace prefixes, and takes a PUT. The password goes only to that
// server: a principal on another host is refused.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let dav, port, evil = false;
const puts = [], auths = [];
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const ms = (body) => `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CR="urn:ietf:params:xml:ns:carddav">${body}</D:multistatus>`;
const resp = (href, prop) => `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${prop}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;

before(async () => {
  const today = new Date();
  const event = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Dentist & check-up\r\nDTSTART:${ymd(today)}T150000Z\r\nDTEND:${ymd(today)}T160000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const card = n => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${n}\r\nitem1.EMAIL;type=INTERNET:${n.split(' ')[0].toLowerCase()}@home.test\r\nTEL;type=CELL:+39 333 000\r\nEND:VCARD\r\n`;
  dav = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      auths.push(req.headers.authorization);
      if (req.headers.authorization !== `Basic ${Buffer.from('al@home.test:app-pw').toString('base64')}`) { res.writeHead(401); return res.end(); }
      const x = b => { res.writeHead(207, { 'Content-Type': 'application/xml' }); res.end(ms(b)); };
      if (req.method === 'PROPFIND' && req.url === '/.well-known/caldav') { res.writeHead(301, { Location: '/dav/' }); return res.end(); }
      if (req.method === 'PROPFIND' && (req.url === '/dav/' || req.url === '/.well-known/carddav'))
        return x(resp(req.url, `<D:current-user-principal><D:href>${evil ? 'http://evil.test:1/p/' : '/principals/al/'}</D:href></D:current-user-principal>`));
      if (req.method === 'PROPFIND' && req.url === '/principals/al/')
        return x(resp('/principals/al/', /calendar-home-set/.test(raw) ? '<C:calendar-home-set><D:href>/cal/al/</D:href></C:calendar-home-set>' : '<CR:addressbook-home-set><D:href>/card/al/</D:href></CR:addressbook-home-set>'));
      if (req.method === 'PROPFIND' && req.url === '/cal/al/')
        return x(resp('/cal/al/', '<D:resourcetype><D:collection/></D:resourcetype>') + resp('/cal/al/home/', '<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Home</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>')
          + resp('/cal/al/tasks/', '<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Tasks</D:displayname><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>'));
      if (req.method === 'PROPFIND' && req.url === '/card/al/') return x(resp('/card/al/contacts/', '<D:resourcetype><D:collection/><CR:addressbook/></D:resourcetype><D:displayname>Contacts</D:displayname>'));
      if (req.method === 'REPORT' && req.url === '/cal/al/home/') return x(resp('/cal/al/home/e1.ics', `<C:calendar-data>${event.replace(/&/g, '&amp;')}</C:calendar-data>`));
      if (req.method === 'REPORT' && req.url === '/card/al/contacts/') return x(resp('/card/al/contacts/1.vcf', `<CR:address-data>${card('Maria Rossi')}</CR:address-data>`) + resp('/card/al/contacts/2.vcf', `<CR:address-data><![CDATA[${card('Gianni Bianchi')}]]></CR:address-data>`));
      if (req.method === 'PUT' && req.url.startsWith('/cal/al/home/') && req.headers['if-none-match'] === '*') { puts.push(raw); res.writeHead(201); return res.end(); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r => dav.listen(0, '127.0.0.1', r));
  port = dav.address().port;
  await H.start();
});
after(async () => { await H.stop(); await new Promise(r => dav.close(r)); });

const base = () => `http://127.0.0.1:${port}/`;

test('discovery, tested on save: calendars with events (not the task list) and an address book; the password never back', async () => {
  const bad = await H.api(null, 'POST', '/api/connectors/nextcloud-dav', { caldav: base(), carddav: base(), user: 'al@home.test', password: 'wrong' });
  assert.equal(bad.body.test.ok, false);
  assert.match(bad.body.test.error, /refused the user name or app password/);
  const r = await H.api(null, 'POST', '/api/connectors/nextcloud-dav', { caldav: base(), carddav: base(), user: 'al@home.test', password: 'app-pw' });
  assert.equal(r.body.test.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.test.summary, '1 calendar, 1 address book');
  assert.ok(!JSON.stringify((await H.api(null, 'GET', '/api/connectors')).body).includes('app-pw'));
  assert.equal((await H.api(null, 'POST', '/api/connectors/nextcloud-dav', { caldav: 'http://dav.example.com/' })).status, 400, 'no password in the clear to another machine');
});

test('the tool: today\'s plan, contacts by name, and a new event that is always asked', async () => {
  const tools = require('../modules/harness/tools');
  assert.match(await tools.call('connector_nextcloud-dav', { action: 'calendars' }), /Home; 1 address book/);
  const today = await tools.call('connector_nextcloud-dav', { action: 'today' });
  assert.match(today, /Dentist & check-up/, 'entities decoded');
  const people = await tools.call('connector_nextcloud-dav', { action: 'contacts', query: 'maria' });
  assert.match(people, /1 contact matching "maria" \(of 2\):\n- Maria Rossi · maria@home\.test · \+39 333 000/);
  assert.equal(require('../modules/harness/approval').gate('connector_nextcloud-dav', { action: 'create_event', title: 'Dinner', from: '2026-10-09T20:00' })?.forced, true);
  const made = await tools.call('connector_nextcloud-dav', { action: 'create_event', title: 'Dinner, at last', from: '2026-10-09T20:00:00Z', to: '2026-10-09T22:00:00Z', where: 'Trattoria' });
  assert.match(made, /Added "Dinner, at last" to Home/);
  assert.match(puts[0], /SUMMARY:Dinner\\, at last\r\n/);
  assert.match(puts[0], /DTSTART:20261009T200000Z/);
});

test('a server that points to another host gets no password there', async () => {
  evil = true;
  require('../modules/connectors/ways').get('dav').forget('nextcloud-dav');
  const before = auths.length;
  const t = await H.api(null, 'POST', '/api/connectors/nextcloud-dav/test');
  assert.equal(t.body.test.ok, false);
  assert.match(t.body.test.error, /not 127\.0\.0\.1:\d+'s: the password is not sent there|did not say where/);
  assert.ok(auths.length > before);
  evil = false;
});
