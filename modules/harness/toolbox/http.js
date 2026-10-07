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
      const send = async () => {
        if (exchange) { token = await keys.token(exchange, { fresh: !!token }); h = { ...h, Authorization: `Bearer ${token}` }; }
        return fetch(url, { method: (method || (payload instanceof FormData ? 'POST' : 'GET')).toUpperCase(), body: payload, headers: h, signal: AbortSignal.timeout(save_as ? 300000 : 60000) });
      };
      let r;
      try { r = await send(); if (exchange && r.status === 401) r = await send(); }   // a token that ran out: one more, fresh
      catch (e) { return `Error: ${keys.scrub(e.message, secret, token)}`; }
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
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || /^127\./.test(h)) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = /^100\.(\d+)\./.exec(h); if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return true;   // the tailnet's CGNAT range
  if (/^f[cd][0-9a-f]{2}:/.test(h) || h.endsWith('.local') || h.endsWith('.ts.net') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;
  try { if (h === require('os').hostname().toLowerCase()) return true; } catch { /* no name */ }
  return false;
}

module.exports = { request, fileOf, owned, looksText };
