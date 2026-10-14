'use strict';

/**
 * Whether each thing in the cast list answers now (the owner, 2026-10-14: a saved TV that is off still shows, greyed):
 * a TCP connect to its Cast port, or its DLNA control's, nothing sent, a short wait. Only for an address on this hub's
 * own network — one seen from a client elsewhere is reached through that client (things.js `via`), so here it is
 * neither "answers" nor "off" but unknown. Read when the list is drawn, in parallel; nothing kept.
 */
const net = require('net');

const WAIT_MS = 800;

function knock(host, port) {
  return new Promise(resolve => {
    const s = net.connect({ host, port, timeout: WAIT_MS });
    const done = v => { s.destroy(); resolve(v); };
    s.once('connect', () => done(true)); s.once('timeout', () => done(false)); s.once('error', () => done(false));
  });
}

const sameNet = (ip, own) => !!own?.address && String(ip).split('.').slice(0, 3).join('.') === own.address.split('.').slice(0, 3).join('.');

/** The list with `answers: true | false | null` and, when false, `why` in words. */
async function withAnswers(list) {
  let own = null;
  try { own = require('../nearby/network').ownSubnet(); } catch { /* no network reading: all unknown */ }
  return Promise.all(list.map(async t => {
    if (!t.address || !t.port || !sameNet(t.address, own)) return { ...t, answers: null };
    const ok = await knock(t.address, t.port);
    return ok ? { ...t, answers: true } : { ...t, answers: false, why: 'not answering now — off or asleep?' };
  }));
}

module.exports = { withAnswers, knock, sameNet };
