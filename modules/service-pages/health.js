'use strict';

/**
 * Whether each connected service answers: its health route asked by the hub (with its key), every minute and after
 * every change, at most 5 s each. A page shows only while its service answers; a change of state is said on the live
 * feed (`screen`, `services`) so open panels add or drop the page at once, and is a line in the activity log.
 */
const services = require('./index');

const EVERY_MS = 60e3, TIMEOUT_MS = 5000;
const _state = new Map();   // id → { up, at, why }
let _timer = null;

/** The request to a service, its key added by the hub (never the browser's). */
function request(s, path, headers = {}) {
  let url = `${s.url}${path}`, h = { ...headers };
  if (s.key) { const a = require('../service-keys').apply(s.key, url, h); url = a.url; h = a.headers; }
  return { url, headers: h };
}

async function check(s) {
  const was = _state.get(s.id)?.up;
  let up = false, why = null;
  try {
    const { url, headers } = request(s, s.health);
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    up = r.ok; why = r.ok ? null : `its health route answered ${r.status}`;
  } catch (e) { why = e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : (e.cause?.code || e.message); }
  _state.set(s.id, { up, at: new Date().toISOString(), why });
  if (was !== undefined && was !== up) {
    try { require('../live').changed('screen', null, 'services', { id: s.id, up }); } catch { /* no feed in a test */ }
    try { require('../activity').note({ from: 'services', what: `${s.name} ${up ? 'answers: its page is shown' : `stopped answering: its page is hidden (${why})`}`, why: 'its health route' }); } catch { /* bookkeeping */ }
  }
  return _state.get(s.id);
}

const checkAll = () => Promise.all(services.all().map(check));
const of = id => _state.get(id) || { up: false, at: null, why: 'not checked yet' };

function start() {
  if (_timer) return;
  require('./run').boot().catch(e => console.warn(`[service-pages] boot: ${e.message}`));   // those marked to start with DOCA
  checkAll().catch(() => {});
  _timer = setInterval(() => checkAll().catch(() => {}), EVERY_MS);
  _timer.unref?.();
}
function stop() { clearInterval(_timer); _timer = null; }

module.exports = { check, checkAll, of, start, stop, request, _state };
