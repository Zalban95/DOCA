'use strict';

/**
 * One row per thing, whichever sources saw it: sightings that share a key — a MAC, a Cast id, a UPnP UDN, a Bluetooth
 * address, a tailnet id, a Home Assistant entity, or (within one scan) a private IPv4 address — are one thing. Then the
 * scan is joined to what was seen before (`into`): the same thing keeps its id and when it was first seen.
 *
 * Kind is the heaviest guess any sighting made (a Cast device saying "speaker" outweighs a maker's name); the name the
 * most telling one (Cast's friendly name, UPnP's, Bluetooth's, Bonjour's, the tailnet's, reverse DNS — in that order).
 */
const crypto = require('crypto');

const STRONG = ['mac', 'cast', 'udn', 'bt', 'ts', 'ha'];
const NAME_ORDER = ['cast', 'homeassistant', 'ssdp', 'bluetooth', 'mdns', 'tailscale', 'lan'];
const KINDS = ['tv', 'speaker', 'printer', 'phone', 'computer', 'light', 'router', 'storage', 'camera', 'headphones', 'watch', 'accessory', 'smart', 'unknown'];

const kindOfKey = key => key.slice(0, key.indexOf(':'));
const idFor = key => `t_${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`;

/** The key a thing is best known by: its strongest, else its address. */
const mainKey = keys => STRONG.map(s => keys.find(x => kindOfKey(x) === s)).find(Boolean) || keys[0];

/** Two MACs that differ say two things, whatever address they shared at some time. */
const clash = (a, b) => { const ma = a.filter(x => x.startsWith('mac:')), mb = b.filter(x => x.startsWith('mac:')); return ma.length && mb.length && !ma.some(x => mb.includes(x)); };

/** Sightings of one scan → things (without ids from before). */
function group(sightings) {
  const parent = sightings.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  sightings.forEach((s, i) => {
    for (const key of s.keys || []) {
      if (!owner.has(key)) { owner.set(key, i); continue; }
      const j = find(owner.get(key));
      if (key.startsWith('ip:') && clash(sightings[j].keys, s.keys)) continue;
      parent[find(i)] = j;
    }
  });
  const groups = new Map();
  sightings.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
  return [...groups.values()].map(combine);
}

const uniq = xs => [...new Set(xs.filter(Boolean))];

function combine(list) {
  const by = src => list.find(s => s.source === src && s.name);
  const named = NAME_ORDER.map(by).find(Boolean);
  const maker = list.map(s => s.maker).find(Boolean) || null;
  const kinds = list.flatMap(s => s.kinds || []).sort((a, b) => b.w - a.w);
  const isPrivate = list.some(s => s.private);
  const keys = uniq(list.flatMap(s => s.keys || []));
  const how = Object.assign({}, ...list.map(s => s.how || {}));
  return {
    name: named?.name || (maker ? `${maker} device` : isPrivate ? 'A device with a private address' : null)
      || (list.find(s => s.addresses?.length) ? `A device at ${list.find(s => s.addresses?.length).addresses[0]}` : 'Something unnamed'),
    kind: kinds[0]?.kind || 'unknown',
    keys, addresses: uniq(list.flatMap(s => s.addresses || [])), mac: list.map(s => s.mac).find(Boolean) || null, bt: list.map(s => s.bt).find(Boolean) || null,
    maker, model: list.map(s => s.model).find(Boolean) || null, private: isPrivate && !maker,
    sources: uniq(list.map(s => s.source)), can: uniq(list.flatMap(s => s.can || [])), services: uniq(list.flatMap(s => s.services || [])),
    web: list.map(s => s.web).find(Boolean) || null, how, details: uniq(list.map(s => s.detail)),
    paired: list.some(s => s.paired), connected: list.some(s => s.connected), area: list.map(s => s.area).find(Boolean) || null,
  };
}

/** Whether a thing of this scan is one seen before: a strong key in common, or an address when no MAC says otherwise. */
function same(a, b) {
  const strong = a.keys.filter(x => !x.startsWith('ip:'));
  if (strong.some(x => b.keys.includes(x))) return true;
  // An address alone joins only things that have no strong key of the same kind telling them apart.
  return a.keys.some(x => x.startsWith('ip:') && b.keys.includes(x)) && !STRONG.some(s => {
    const ka = a.keys.filter(x => kindOfKey(x) === s), kb = b.keys.filter(x => kindOfKey(x) === s);
    return ka.length && kb.length && !ka.some(x => kb.includes(x));
  });
}

/**
 * Join this scan's things to those seen before. Returns the whole list: the ones seen now (with `lastSeen` = now), and
 * the earlier ones not seen this time, as they were. `scanned` are the sources this scan looked with.
 */
function into(before, things, now = new Date().toISOString()) {
  const out = before.map(t => ({ ...t }));
  for (const t of things) {
    const was = out.find(o => same(t, o));
    if (was) {
      const strong = was.keys.filter(x => !x.startsWith('ip:'));
      Object.assign(was, { ...t, id: was.id, firstSeen: was.firstSeen, lastSeen: now, keys: uniq([...t.keys, ...strong]),
        sources: uniq([...t.sources, ...(was.sources || [])]), can: uniq([...t.can, ...(was.can || [])]) });
    } else {
      out.push({ ...t, id: idFor(mainKey(t.keys)), firstSeen: now, lastSeen: now });
    }
  }
  return out;
}

module.exports = { group, combine, into, same, mainKey, idFor, KINDS, STRONG };
