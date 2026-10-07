'use strict';

/**
 * Node's words for an HTTP server it could not reach are "fetch failed" — no address, no owner, nothing a person can
 * act on (the self-test of 2026-10-08 read it under ▶ Connect as no answer at all). This says which server, at which
 * address, why in plain words, and what to check — and keeps Node's own words at the end, since the exact string is
 * what a person searches for.
 */
const WHY = {
  ECONNREFUSED: 'nothing is listening there',
  ENOTFOUND: 'that name does not resolve to a machine',
  EAI_AGAIN: 'that name could not be looked up just now',
  ETIMEDOUT: 'the machine did not answer in time',
  EHOSTUNREACH: 'that machine cannot be reached from here',
  ENETUNREACH: 'that network cannot be reached from here',
  ECONNRESET: 'the connection was dropped',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'its certificate is self-signed, so it is not trusted',
  SELF_SIGNED_CERT_IN_CHAIN: 'its certificate is self-signed, so it is not trusted',
  CERT_HAS_EXPIRED: 'its certificate has expired',
};

function reachError(e, id, url) {
  if (!(e instanceof TypeError) || !/fetch failed/i.test(e.message)) return e;
  const code = e.cause?.code || e.cause?.message || '';   // a code, or what Node said instead ("bad port")
  const why = WHY[code] || 'it did not answer';
  return new Error(`Could not reach "${id}" at ${url}: ${why}. Check that its server is running on that machine and `
    + `that the address is right. (${e.message}${code ? `: ${code}` : ''})`);
}

module.exports = reachError;
