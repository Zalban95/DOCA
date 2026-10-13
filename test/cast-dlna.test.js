'use strict';

// A TV or speaker without Cast, played to over DLNA / UPnP (R3e; cast/dlna.js): SetAVTransportURI with DIDL-Lite, then
// Play; the renderer fetches the sound from the hub's door itself, to it alone; Stop; the volume by RenderingControl;
// a page is refused (no browser); a control address off the private network is never spoken to.
process.env.DOCA_CAST_DOOR_ADDRESS = '127.0.0.1';
process.env.DOCA_CAST_DOOR_PORT = '0';
process.env.DOCA_DLNA_LOOPBACK = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let tts, renderer, speaker, heard = [], fetched = [];
test.before(async () => {
  await H.start();
  tts = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(3210, 3)); });
  await new Promise(r => tts.listen(0, '127.0.0.1', r));
  // The renderer: answers each SOAP action, and on Play fetches the URI it was given.
  renderer = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', async () => {
      const action = String(req.headers.soapaction || '').replace(/"/g, '').split('#')[1];
      heard.push({ path: req.url, action, body: b });
      if (action === 'Play') {
        const uri = (/<CurrentURI>([^<]*)<\/CurrentURI>/.exec(heard.find(h => h.action === 'SetAVTransportURI')?.body || '') || [])[1];
        const r = await fetch(uri.replace(/&amp;/g, '&')).catch(e => ({ status: e.message }));
        fetched.push({ uri, status: r.status, bytes: r.arrayBuffer ? (await r.arrayBuffer()).byteLength : 0 });
      }
      res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(`<s:Envelope><s:Body><u:${action}Response/></s:Body></s:Envelope>`);
    });
  });
  await new Promise(r => renderer.listen(0, '127.0.0.1', r));
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), voiceServices: { ttsUrl: `http://127.0.0.1:${tts.address().port}`, ttsModel: 'stub', ttsVoice: 'af_heart' }, cast: { door: 'on' } });
  const base = `http://127.0.0.1:${renderer.address().port}`;
  const store = require('../modules/nearby/store');
  store.writeSeen([{ id: 'd1', name: 'Hall speaker', kind: 'speaker', keys: ['udn:uuid:hall'], addresses: ['127.0.0.1'], can: ['dlna-play'], sources: ['ssdp'],
    how: { dlna: { control: `${base}/avt`, volume: `${base}/rc`, ip: '127.0.0.1' } } }]);
  speaker = store.save({ seenId: 'd1', place: 'Home', room: 'Hall' });
});
test.after(async () => { await require('../modules/cast/door').close(); tts.close(); renderer.close(); await H.stop(); });

test('a DLNA speaker is listed, says a sentence, and fetches it from the door itself', async () => {
  const list = (await H.api(null, 'GET', '/api/cast/things')).body.things;
  const t = list.find(x => x.id === speaker.id);
  assert.deepEqual([t.via, t.shows, t.address], ['dlna', false, '127.0.0.1']);
  const r = await H.api(null, 'POST', `/api/cast/things/${speaker.id}/say`, { text: 'The laundry is done.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(heard.map(h => h.action), ['SetAVTransportURI', 'Play']);
  assert.match(heard[0].body, /DIDL-Lite.*The laundry is done\..*audio\/mpeg/s, 'it is told what it plays');
  assert.equal(fetched[0].status, 200);
  assert.equal(fetched[0].bytes, 3210);
  assert.match(fetched[0].uri, /^http:\/\/127\.0\.0\.1:\d+\/api\/cast\/media\/[0-9a-f]{32}$/);
});

test('volume by RenderingControl, Stop by AVTransport; a page is not this way', async () => {
  heard = [];
  assert.equal((await H.api(null, 'POST', `/api/cast/things/${speaker.id}/volume`, { level: 0.35 })).status, 200);
  assert.equal(heard[0].path, '/rc');
  assert.match(heard[0].body, /<DesiredVolume>35<\/DesiredVolume>/);
  assert.equal((await H.api(null, 'POST', `/api/cast/things/${speaker.id}/stop`, {})).status, 200);
  assert.equal(heard[1].action, 'Stop');
  const page = await H.api(null, 'POST', `/api/cast/things/${speaker.id}/show`, { page: 'live' });
  assert.equal(page.status, 409);
  assert.match(page.body.error, /no browser/);
});

test('a control address off the private network is never spoken to; a fault is said in words', async () => {
  const dlna = require('../modules/cast/dlna');
  await assert.rejects(dlna.stop({ control: 'http://203.0.113.9/avt' }), /not on a private network/);
  const faulty = http.createServer((req, res) => { req.resume(); res.writeHead(500); res.end('<s:Fault><detail><UPnPError><errorDescription>Transition not available</errorDescription></UPnPError></detail></s:Fault>'); });
  await new Promise(r => faulty.listen(0, '127.0.0.1', r));
  await assert.rejects(dlna.stop({ control: `http://127.0.0.1:${faulty.address().port}/avt` }), /refused Stop: Transition not available/);
  faulty.close();
});

test('a UPnP sighting keeps where its volume is set, and its address', () => {
  const s = require('../modules/nearby/sightings').upnp({ friendlyName: 'Hall', deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:1', from: '192.168.1.50', location: 'http://192.168.1.50:1400/d.xml',
    services: [{ type: 'urn:schemas-upnp-org:service:AVTransport:1', control: 'http://192.168.1.50:1400/avt' }, { type: 'urn:schemas-upnp-org:service:RenderingControl:1', control: 'http://192.168.1.50:1400/rc' }] });
  assert.deepEqual(s.how.dlna, { control: 'http://192.168.1.50:1400/avt', volume: 'http://192.168.1.50:1400/rc', description: 'http://192.168.1.50:1400/d.xml', ip: '192.168.1.50' });
});
