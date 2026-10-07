'use strict';

/**
 * One HTTP request for the agent, shared by http_fetch (reading, any address) and api_call (acting: a keyed service
 * or the owner's own addresses) — moved here unchanged from http_fetch (TODO A2). A key is named and added by the hub
 * only for its own origin and scrubbed from what comes back (service-keys.js); a form and files make a multipart upload;
 * save_as keeps the answer as an attachment instead of reading it.
 */
const { clip } = require('./common');

/** A file the agent names: a path (absolute, or in the work folder) or an attachment's name. */
function fileOf(ref, ctx) {
  const fs = require('fs'), path = require('path');
  const at = require('../../attachments');
  let local = null;
  try { local = require('./common').resolvePath(String(ref), ctx); } catch { /* outside what may be read */ }
  for (const p of [local, path.join(at.dir(), path.basename(String(ref)))].filter(Boolean)) { try { if (fs.statSync(p).isFile()) return path.resolve(p); } catch { /* not this one */ } }
  return null;
}

/** Text by its type or by its bytes (no NUL and nearly all printable in the first 2 KB): a page, whatever it calls itself. */
function looksText(type, bytes) {
  if (/^(text\/|application\/(json|xml|xhtml|javascript|ecmascript|ld\+json|rss|atom)|[^;]*\+(json|xml)\b)/i.test(type || '')) return true;
  const head = bytes.subarray(0, 2048);
  if (!head.length || head.includes(0)) return false;
  let ok = 0; for (const b of head) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) ok++;
  return ok / head.length > 0.95;
}

async function request({ url, method, body, headers, key, form, files, save_as, binaryOnly = false }, ctx = {}) {
      const keys = require('../../service-keys');
      let h = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers && typeof headers === 'object' ? headers : {}) };
      let secret = null, exchange = null, token = null;
      if (key) {
        // No person on the turn (a test, a pre-accounts call) is not narrowed, as everywhere (auth/permits.js).
        const host = require('../../auth/allot').uses(ctx.user, 'key', key);   // an admin, or allotted to them (S13)
        try { ({ url, headers: h, key: secret, exchange } = keys.apply(key, url, h, { host })); }
        catch (e) { return `Error: ${e.message}`; }
      }
      let payload = body || undefined;
      if (form || files) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(form || {})) fd.append(k, String(v));
        for (const [k, ref] of Object.entries(files || {})) {
          const abs = fileOf(ref, ctx);
          if (!abs) return `Error: no file "${ref}" (a path, or the name of an attachment).`;
          if (require('../secret-view').kindOf(abs)) return `Error: ${ref} holds secrets beside settings and is never uploaded.`;
          const st = require('fs').statSync(abs);
          if (st.size > 50 * 1024 * 1024) return `Error: ${ref} is over 50 MB.`;
          fd.append(k, new Blob([require('fs').readFileSync(abs)], { type: require('../../attachments').mimeFor(abs) }), require('path').basename(abs));
        }
        payload = fd;
        delete h['Content-Type'];   // the form sets its own boundary
      }
      const verb = (method || (payload instanceof FormData ? 'POST' : 'GET')).toUpperCase();
      const send = async () => {
        if (exchange) { token = await keys.token(exchange, { fresh: !!token }); h = { ...h, Authorization: `Bearer ${token}` }; }
        return fetch(url, { method: verb, body: payload, headers: h, redirect: 'manual', signal: AbortSignal.timeout(save_as ? 300000 : 60000) });
      };
      let r;
      try { r = await send(); if (exchange && r.status === 401) r = await send(); }   // a token that ran out: one more, fresh
      catch (e) { return `Error: ${keys.scrub(e.message, secret, token)}`; }
      // Redirects are followed here, each hop checked (security review 2026-10-07): a key never leaves its own origin,
      // and an address read as the owner's own never hands over a page from the open web, which is the reader's.
      const start = new URL(url), stayOwned = !ctx.airlock && owned(url);
      for (let hop = 0; hop < 5 && [301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location'); hop++) {
        let next;
        try { next = new URL(r.headers.get('location'), url); } catch { break; }
        if (!/^https?:$/.test(next.protocol)) return `Error: ${String(url).slice(0, 120)} redirects to a ${next.protocol} address, which is not followed.`;
        if ((secret || exchange || key) && next.origin !== start.origin) return `Error: ${String(url).slice(0, 120)} redirects to ${next.origin}; the key is sent only to ${start.origin}, so it was not followed.`;
        if (stayOwned && !owned(next.href)) return `Error: ${String(url).slice(0, 120)} redirects outside the owner's addresses (${next.href.slice(0, 160)}). Read that page with http_fetch: the open web reaches you through its reader.`;
        if (verb !== 'GET' && verb !== 'HEAD') break;   // a redirected write is answered as it is, never re-sent
        url = next.href;
        try { r = await send(); } catch (e) { return `Error: ${keys.scrub(e.message, secret, token)}`; }
      }
      if (save_as && r.ok) {
        const bytes = Buffer.from(await r.arrayBuffer());
        // A keyless download from an address that is not the owner's keeps a file, never a page: text is reading the
        // web, which is the airlock's (scout, http_fetch) — kept and then read, it would go around it (found 2026-10-07
        // by the live model reviewing A2).
        if (binaryOnly && looksText(r.headers.get('content-type'), bytes))
          return `Error: ${String(url).slice(0, 120)} answered with text (${r.headers.get('content-type') || 'no type'}), and a download without a key keeps only files such as a model, a picture or an archive. Reading a page is http_fetch's, or the scout's while specialists are on.`;
        const at = require('../../attachments');
        const rec = at.save(bytes, String(save_as).replace(/[\\/]/g, '_').slice(0, 120), { from: 'agent', ...(/^(application\/octet-stream|binary\/)/.test(r.headers.get('content-type') || 'application/octet-stream') ? {} : { mime: r.headers.get('content-type') }) });
        return `HTTP ${r.status}: saved ${at.humanBytes(bytes.length)} as ${rec.name} (${rec.path}). show_media shows it${at.playableKind(at.mimeFor(rec.name)) === 'model' ? ' as a 3D model' : ''}.`;
      }
      const out = `HTTP ${r.status} ${r.statusText}\n\n${await r.text()}`;
      return clip(secret || token ? keys.scrub(out, secret, token) : out);
}

/**
 * Whether an address is the owner's own: this machine (loopback), the local network (private IPv4 ranges, fc00::/7,
 * .local), the tailnet (100.64.0.0/10, .ts.net) or one of this hub's own names. api_call reaches these without a key;
 * anything else needs a stored key for its origin (TODO A2, CONSTITUTION V4 and S6).
 */
function owned(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const h = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  // Ranges apply to addresses written as addresses only: "10.evil.com" is a name that starts with digits (security
  // review 2026-10-07), and a name is the owner's only when it is one of these, never because of how it begins.
  const ip = require('net').isIP(h);
  if (ip === 4) return privateV4(h);
  if (ip === 6) {
    const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (v4) return privateV4(v4[1]);
    return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);   // loopback, unique local, link-local
  }
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;   // never resolved on the public internet
  // The tailnet: this hub's own MagicDNS suffix — not any *.ts.net, which public Funnel names share.
  const tail = require('../../network').tailnetSuffix();
  if (tail && (h === tail || h.endsWith(`.${tail}`))) return true;
  try { if (h === require('os').hostname().toLowerCase()) return true; } catch { /* no name */ }
  return false;
}

/** 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16 and the tailnet's 100.64/10 — for an address written as one. */
function privateV4(h) {
  const [a, b] = h.split('.').map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

module.exports = { request, fileOf, owned, looksText };
