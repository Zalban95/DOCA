'use strict';

/**
 * Playing to a DLNA / UPnP renderer (docs/design/cast-reach.md §3.2; R3e): a TV or a speaker without Cast that Nearby
 * saw over UPnP keeps its AVTransport control address (nearby/sightings.js `how.dlna`). Telling it what to play is two
 * SOAP requests to that address — SetAVTransportURI (the sound's address, with DIDL-Lite saying what it is) then Play —
 * and Stop; the volume is RenderingControl's SetVolume when it listed one. What it plays it fetches itself over plain
 * HTTP, from the hub's cast door (door.js), to that device alone. A renderer has no browser: a page is not this way.
 * Only an address on a private network is ever spoken to (a sighting's control URL is a device's own claim).
 */
const http = require('http');

const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
const RC = 'urn:schemas-upnp-org:service:RenderingControl:1';
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const bad = (m, status = 502) => Object.assign(new Error(m), { status });
const xml = s => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** One SOAP action: resolves the response text, or rejects with the renderer's fault in words. */
function soap(control, service, action, args = {}, { ms = 8000 } = {}) {
  let u;
  try { u = new URL(control); } catch { return Promise.reject(bad('This device gave no control address that can be read.')); }
  if (u.protocol !== 'http:' || !(PRIVATE_V4.test(u.hostname) || (process.env.DOCA_DLNA_LOOPBACK === '1' && u.hostname === '127.0.0.1')))
    return Promise.reject(bad('This device\'s control address is not on a private network: it is not spoken to.', 400));
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">`
    + `<s:Body><u:${action} xmlns:u="${service}">${Object.entries(args).map(([k, v]) => `<${k}>${xml(v)}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  return new Promise((resolve, reject) => {
    const req = http.request(u, { method: 'POST', timeout: ms, headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${service}#${action}"`, 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', c => { if (text.length < 65536) text += c; });
      res.on('end', () => {
        if (res.statusCode === 200) return resolve(text);
        const why = (/<errorDescription>([^<]*)<\/errorDescription>/i.exec(text) || [])[1] || (/<faultstring>([^<]*)<\/faultstring>/i.exec(text) || [])[1] || `HTTP ${res.statusCode}`;
        reject(bad(`The device refused ${action}: ${why}.`));
      });
    });
    req.on('timeout', () => { req.destroy(); reject(bad(`The device did not answer ${action}.`)); });
    req.on('error', e => reject(bad(`Cannot reach the device: ${e.code || e.message}.`)));
    req.end(body);
  });
}

/** What the renderer is told it plays: DIDL-Lite with the title and the kind of sound. */
function didl(url, mime, title) {
  const cls = /^video\//.test(mime) ? 'object.item.videoItem' : /^image\//.test(mime) ? 'object.item.imageItem' : 'object.item.audioItem.musicTrack';
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">`
    + `<item id="0" parentID="-1" restricted="1"><dc:title>${xml(title || 'DOCA')}</dc:title><upnp:class>${cls}</upnp:class>`
    + `<res protocolInfo="http-get:*:${xml(mime)}:*">${xml(url)}</res></item></DIDL-Lite>`;
}

async function play(how, url, mime, title) {
  await soap(how.control, AVT, 'SetAVTransportURI', { InstanceID: 0, CurrentURI: url, CurrentURIMetaData: didl(url, mime, title) });
  await soap(how.control, AVT, 'Play', { InstanceID: 0, Speed: 1 });
}

const stop = how => soap(how.control, AVT, 'Stop', { InstanceID: 0 });

async function volume(how, level) {
  if (!how.volume) throw bad('This device does not let its volume be set over the network.', 409);
  await soap(how.volume, RC, 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: Math.round(Math.max(0, Math.min(1, level)) * 100) });
}

module.exports = { soap, didl, play, stop, volume, AVT, RC };
