'use strict';

const { MASK } = require('../secrets-mask');

/**
 * Secrets that ride in an address or on a command line, masked like env and headers (audit 2026-10-07): a client-hosted
 * server's URL carries its bearer secret in the path (`/mcp/<secret>`), and GET /api/mcp — readable with `read` — handed
 * it out; a stdio server's `--token <value>` likewise. A path segment or query value long and random enough to be a
 * secret, and the value after a secret-named flag, read as MASK; the unmask halves put them back on save.
 */
const SECRETISH = /^[A-Za-z0-9_-]{20,}$/;
const SECRET_FLAG = /^--?[\w-]*(token|key|secret|password|passwd|bearer)[\w-]*$/i;

function maskUrl(url) {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.split('/').map(seg => (SECRETISH.test(seg) && /\d/.test(seg) ? MASK : seg)).join('/');
    for (const [k, v] of [...u.searchParams]) if (SECRETISH.test(v) || /token|key|secret|password/i.test(k)) u.searchParams.set(k, MASK);
    return decodeURI(u.toString());
  } catch { return url; }
}

function unmaskUrl(next, previous) {
  if (!next || !next.includes(MASK) || !previous) return next;
  const a = next.split(/([/?&=])/), b = previous.split(/([/?&=])/);
  return a.length === b.length ? a.map((x, i) => (x === MASK ? b[i] : x)).join('') : previous;
}

function maskArgs(args = []) {
  return args.map((a, i) => (i > 0 && SECRET_FLAG.test(String(args[i - 1])) ? MASK : String(a).replace(/^(--?[\w-]*(?:token|key|secret|password)[\w-]*=).+$/i, `$1${MASK}`)));
}

function unmaskArgs(next = [], previous = []) {
  return next.map((a, i) => (String(a).includes(MASK) && previous[i] !== undefined ? previous[i] : a));
}

module.exports = { maskUrl, unmaskUrl, maskArgs, unmaskArgs };
