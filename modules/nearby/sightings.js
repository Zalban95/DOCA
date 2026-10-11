'use strict';

/**
 * What each source saw, said one way: a sighting — {source, name, keys, addresses, mac, maker, model, kinds, can,
 * web, how, detail}. `keys` are who it is (`mac:`, `cast:`, `udn:`, `bt:`, `ts:`, `ha:`, `ip:`), which merge.js joins
 * across sources; `kinds` are guesses with a weight (a Cast device saying it is a speaker outweighs a maker's name);
 * `can` is what it can do (cast, airplay, dlna-play, print, web, ssh, files, bluetooth-audio…) and `how` the facts
 * an agent needs to do it (a control URL, a port). Pure: the tests feed it what the parsers return.
 */

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const ipKey = ip => (PRIVATE_V4.test(ip || '') ? [`ip:${ip}`] : []);
const k = (kind, w) => ({ kind, w });

/** Cast devices from mDNS (`_googlecast._tcp`) or catt. A Home/Nest speaker is a speaker; a Chromecast a TV. */
function cast(x, from = 'cast') {
  const model = x.txt?.md || x.model || '';
  const name = x.txt?.fn || x.name;
  const ip = x.addresses?.[0] || x.ip;
  const speaker = /home|nest (mini|audio|hub)?|speaker|audio|soundbar/i.test(model) && !/hub max|nest hub/i.test(model);
  return { source: from, name, keys: [...(x.txt?.id ? [`cast:${x.txt.id.toLowerCase()}`] : []), ...ipKey(ip)], addresses: ip ? [ip] : [],
    maker: x.maker || (x.txt ? 'Google' : null), model, kinds: [k(speaker ? 'speaker' : 'tv', 9)], can: ['cast'],
    how: { cast: { name, ip, port: x.port || 8009 } } };
}

// Bonjour service types → what they say the thing is and can do.
const MDNS = {
  _airplay: { kind: 'tv', w: 5, can: 'airplay' }, _raop: { kind: 'speaker', w: 4, can: 'airplay-audio' },
  _ipp: { kind: 'printer', w: 8, can: 'print' }, _ipps: { kind: 'printer', w: 8, can: 'print' }, _printer: { kind: 'printer', w: 8, can: 'print' },
  '_pdl-datastream': { kind: 'printer', w: 8, can: 'print' }, _scanner: { kind: 'printer', w: 6 }, _uscan: { kind: 'printer', w: 6 },
  _hap: { kind: 'smart', w: 4, can: 'homekit' }, '_spotify-connect': { kind: 'speaker', w: 5, can: 'spotify' }, _sonos: { kind: 'speaker', w: 8 },
  _http: { can: 'web' }, _https: { can: 'web' }, _ssh: { kind: 'computer', w: 3, can: 'ssh' }, '_sftp-ssh': { kind: 'computer', w: 3, can: 'files' },
  _smb: { kind: 'computer', w: 2, can: 'files' }, _afpovertcp: { kind: 'computer', w: 2, can: 'files' }, _rfb: { kind: 'computer', w: 3, can: 'vnc' },
  _workstation: { kind: 'computer', w: 3 }, '_companion-link': { kind: 'phone', w: 3 }, '_apple-mobdev2': { kind: 'phone', w: 4 },
  '_home-assistant': { kind: 'computer', w: 3, can: 'web' }, _googlezone: {}, _googcrossdevice: {}, _matter: { kind: 'smart', w: 4 }, _hue: { kind: 'light', w: 7 },
  '_philipshue': { kind: 'light', w: 7 }, _daap: { kind: 'computer', w: 2 }, _mqtt: { kind: 'computer', w: 2 },
};

/** Any Bonjour instance (not a Cast one: that is cast()). */
function mdns(x) {
  const base = x.type.split('.')[0];
  const m = MDNS[base] || {};
  const ip = x.addresses.find(a => /^\d/.test(a)) || null;
  const web = m.can === 'web' && ip ? `${base === '_https' ? 'https' : 'http'}://${ip}${x.port && ![80, 443].includes(x.port) ? `:${x.port}` : ''}${x.txt?.path || '/'}` : null;
  const how = {};
  if (m.can === 'print' && ip) how.print = { url: `ipp://${ip}:${x.port || 631}/${String(x.txt?.rp || 'ipp/print').replace(/^\//, '')}` };
  if (m.can === 'ssh' && ip) how.ssh = { host: (x.host || ip).replace(/\.$/, ''), port: x.port || 22 };
  if (m.can === 'airplay' || m.can === 'airplay-audio') how.airplay = { ip, port: x.port };
  const model = x.txt?.model || x.txt?.md || x.txt?.ty || x.txt?.am || null;
  return { source: 'mdns', name: cleanName(x.name), keys: [...ipKey(ip), ...(x.txt?.deviceid && /^[0-9a-f:]{17}$/i.test(x.txt.deviceid) ? [`mac:${x.txt.deviceid.toLowerCase()}`] : [])],
    addresses: ip ? [ip] : [], model, kinds: m.kind ? [k(m.kind, m.w)] : [], can: m.can ? [m.can] : [], web, how, services: [base] };
}

// "Google-Home-Mini-845b…" and "ac1d2e3f4a5b@Living Room" → the part a person would read.
const cleanName = n => String(n || '').replace(/^[0-9A-F]{12}@/i, '').replace(/-[0-9a-f]{24,}$/i, '').replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(+d)).trim();

/** A UPnP / DLNA device from its description. */
function upnp(x) {
  const dt = String(x.deviceType || x.st || '');
  const words = `${x.manufacturer} ${x.modelName} ${x.friendlyName}`;
  const kinds = [];
  if (/MediaRenderer/i.test(dt)) kinds.push(k(/\b(sonos|speakers?|audio|soundbar|amplifier|receiver)\b/i.test(words) && !/\btv\b/i.test(words) ? 'speaker' : 'tv', 7));
  if (/InternetGatewayDevice|WANDevice|WFADevice/i.test(dt)) kinds.push(k('router', 6));
  if (/MediaServer/i.test(dt)) kinds.push(k('storage', 3));
  if (/Printer/i.test(dt)) kinds.push(k('printer', 7));
  if (/hue|philips/i.test(words) && /Basic/i.test(dt)) kinds.push(k('light', 7));
  const avt = (x.services || []).find(s => /AVTransport/i.test(s.type));
  const can = [...(avt ? ['dlna-play'] : []), ...(x.presentationURL ? ['web'] : [])];
  return { source: 'ssdp', name: x.friendlyName || null, keys: [...(x.udn ? [`udn:${x.udn.toLowerCase()}`] : []), ...ipKey(x.from)], addresses: x.from ? [x.from] : [],
    maker: x.manufacturer || null, model: [x.modelName, x.modelNumber].filter(Boolean).join(' ') || null, kinds, can,
    web: x.presentationURL && /^https?:/.test(x.presentationURL) ? x.presentationURL : null, how: avt ? { dlna: { control: avt.control, description: x.location } } : {} };
}

// Makers whose cards say what the thing most likely is.
const MAKER_KIND = { 'Raspberry Pi': 'computer', Espressif: 'smart', 'Philips Hue': 'light', Sonos: 'speaker', Ubiquiti: 'router', AVM: 'router',
  Amazon: 'speaker', VMware: 'computer', VirtualBox: 'computer', QEMU: 'computer', Brother: 'printer' };

/** A neighbour from the OS's table. */
function lan(x) {
  const kinds = [];
  if (x.gateway) kinds.push(k('router', 8));
  if (x.maker && MAKER_KIND[x.maker]) kinds.push(k(MAKER_KIND[x.maker], 2));
  return { source: 'lan', name: x.name ? x.name.split('.')[0] : null, keys: [`mac:${x.mac}`, ...ipKey(x.ip)], addresses: [x.ip], mac: x.mac,
    maker: x.maker || null, private: !!x.private, kinds, can: [], detail: x.gateway ? 'the router (this network\'s gateway)' : null };
}

const BT_ICON = { 'audio-headset': 'headphones', 'audio-headphones': 'headphones', 'audio-card': 'speaker', phone: 'phone', computer: 'computer',
  'input-keyboard': 'accessory', 'input-mouse': 'accessory', 'input-gaming': 'accessory', 'input-tablet': 'accessory', watch: 'watch', printer: 'printer', camera: 'camera' };

function bluetooth(x) {
  const kind = BT_ICON[x.icon] || (/headphone|headset|earbud|airpods|buds/i.test(x.name || '') ? 'headphones' : /speaker|soundbar|jbl|bose/i.test(x.name || '') ? 'speaker' : null);
  return { source: 'bluetooth', name: x.name || `Bluetooth device ${x.address}`, keys: [`bt:${x.address.toLowerCase()}`], addresses: [], bt: x.address,
    kinds: kind ? [k(kind, 6)] : [], can: ['bluetooth', ...(x.audio ? ['bluetooth-audio'] : [])],
    detail: [x.paired && 'paired', x.connected && 'connected'].filter(Boolean).join(', ') || null, paired: !!x.paired, connected: !!x.connected };
}

function tailscale(x) {
  const os = String(x.os || '').toLowerCase();
  const kind = /android|ios/.test(os) ? 'phone' : os ? 'computer' : null;
  return { source: 'tailscale', name: x.name, keys: [`ts:${x.id}`], addresses: x.ips.filter(a => /^\d/.test(a)), kinds: kind ? [k(kind, 5)] : [],
    can: ['tailnet'], detail: `${x.os || 'a device'} on the tailnet, ${x.online ? 'online' : 'offline'}${x.dns ? ` (${x.dns})` : ''}`, how: { tailnet: { dns: x.dns, ips: x.ips } } };
}

const HA_KIND = { light: 'light', media_player: 'speaker', switch: 'smart', fan: 'smart', cover: 'smart', climate: 'smart', lock: 'smart', camera: 'camera', alarm_control_panel: 'smart', vacuum: 'smart' };

function homeAssistant(x) {
  const kind = x.domain === 'media_player' && /tv/i.test(x.deviceClass || '') ? 'tv' : HA_KIND[x.domain] || 'smart';
  return { source: 'homeassistant', name: x.name, keys: [`ha:${x.home}/${x.id}`], addresses: [], kinds: [k(kind, 6)], can: ['home-assistant'],
    detail: `${x.homeName && x.home !== 'hub' ? `${x.homeName}: ` : ''}${x.id}${x.area ? ` in ${x.area}` : ''}, ${x.state}`, how: { ha: { entity: x.id, home: x.home } }, area: x.area || null };
}

module.exports = { cast, mdns, upnp, lan, bluetooth, tailscale, homeAssistant, cleanName, MDNS };
