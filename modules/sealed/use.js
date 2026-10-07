'use strict';

/**
 * `secret_use` (CONSTITUTION S4; TODO P1.3): a secret typed or pasted on one of the person's devices, for a set number
 * of uses and a short time, then forgotten there — `computer_login`'s fill, made general. The agent names the secret
 * and the device; it never receives the value, only what happened ("filled", "on the clipboard for 1 paste or 30 s").
 *
 *   the ask      always a person's (forced-asks.js), every approval mode, never "always"; a mission cannot hold it
 *   the secret   one of the secrets for devices (sealed/vault.js), `login:<name>` (a login's password) or `key:<name>`
 *                (a key for services) — the hub's, so used on a host's turn; a key for services is the hub's to send
 *                (api_call), so it is never handed out to anyone else, whoever it was opened to
 *   the device   the turn's person's own paired device, whose MCP server is running here; never someone else's
 *   the way      sealed for that device alone (sealed/seal.js) and given to its hidden `secret_fill`: a web page's
 *                field only on the secret's own site (the device checks the tab), else typed into what has focus or
 *                put on the clipboard for N pastes or T seconds — but a secret that has a site (a login's password, a
 *                key, a secret kept with its address) goes only into that site's field, never typed or pasted where any
 *                window could take it; and for a minute after any use the device's read tools wait (hold.js)
 *   the trace    sealed_uses (when, which, where, by whom, how it went); the transcript, the logs and the trace carry
 *                the arguments the agent wrote, which never hold the value; what the device answers is scrubbed of it
 */
const vault = require('./vault');
const seal = require('./seal');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) && n !== null && n !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : d);

/** Where the secret comes from, by what the agent wrote: { label, origin, value } or an error naming what exists. */
async function sourceOf(ref, { host }) {
  const s = String(ref || '').trim();
  if (/^login:/i.test(s)) {
    if (!host) throw bad('Logins are an admin\'s: used on the turn of someone who holds host.', 403);
    const l = require('../logins').secretOf(s.slice(6));
    if (!l) throw bad(`No login "${s.slice(6)}" (Field → Connectors → Logins).`, 404);
    return { ...l, label: `login:${l.label}` };
  }
  if (/^key:/i.test(s)) {
    const k = require('../service-keys').secretOf(s.slice(4));
    if (!k) throw bad(`No key for services named "${s.slice(4)}".`, 404);
    // A key for services is the hub's to send (api_call), not a person's to paste: opened to everyone means usable by
    // everyone's agents through the hub, never handed to someone's device (security review 2026-10-07).
    if (!host) throw bad(`The key "${k.label}" is the hub's to use (api_call), never handed to a device: only on an admin's turn, and only into its own site's field.`, 403);
    return { label: `key:${k.label}`, origin: k.origin, value: k.value };
  }
  if (!host) throw bad('The secrets for devices are an admin\'s: used on the turn of someone who holds host.', 403);
  const v = await vault.reveal(s);
  if (!v) throw bad(`No secret "${s}". Secrets for devices: ${(await vault.list()).map(x => x.name).join(', ') || 'none yet'} — an admin adds one in Field → Connectors; `
    + 'a login\'s password is login:<name>, a key for services key:<name>.', 404);
  return v;
}

/** The device by id or name: paired, not revoked, the person's own. */
function deviceOf(ref, person, host) {
  const all = require('../api-v1/devices').list().filter(d => !d.revokedAt);
  const s = String(ref || '').trim();
  const hits = all.filter(d => d.id === s || String(d.name || '').toLowerCase() === s.toLowerCase());
  if (!hits.length) throw bad(`No paired device "${s}". doca_clients lists them.`, 404);
  if (hits.length > 1) throw bad(`More than one device is called "${s}": name it by id (${hits.map(d => d.id).join(', ')}).`);
  const d = require('../api-v1/devices').get(hits[0].id);
  // A secret typed on a device is given to whoever holds that device: only ever the person's own (S4, S2).
  if (person?.id && d.userId && d.userId !== person.id) throw bad(`${d.name} is someone else's device: a secret is handed only to the person's own.`, 403);
  if (person?.id && !d.userId && !host) throw bad(`${d.name} belongs to nobody: only an admin may hand it a secret.`, 403);
  return d;
}

/** The device's MCP client, running. */
async function clientOf(d) {
  const reg = require('../mcp/registry');
  const spec = reg.forDevice(d.id);
  if (!spec) throw bad(`${d.name} lends nothing to the hub yet: run doca-client there (or the DOCA browser extension) and accept its offer in the MCP tab.`, 409);
  let c = reg.client(spec.id);
  if (c?.state !== 'running') { try { c = await reg.start(spec.id); } catch (e) { throw bad(`${d.name} is not answering (${e.message}).`, 502); } }
  if (!seal.has(d.id)) throw bad(`${d.name} has not taken its seal key, so it cannot open a sealed secret: update its client (doca-client update, then run it again; or reload the browser extension).`, 409);
  return c;
}

const describe = (how, a) => (how === 'field' ? `field [${a.ref}]${a.tab != null ? ` of tab ${a.tab}` : ''} on ${a.origin}`
  : how === 'type' ? 'typed into what has focus' : `the clipboard, ${a.uses} paste${a.uses === 1 ? '' : 's'} or ${a.ttlSec} s`);

/** The tool: returns the sentence for the agent, never the value. */
async function use(a = {}, ctx = {}) {
  const person = ctx.user?.id ? ctx.user : null;
  const host = !person || require('../auth/rights').can(person.role, 'host');
  const d = deviceOf(a.device, person, host);
  const src = await sourceOf(a.secret, { host });
  const how = a.ref !== undefined && a.ref !== null ? 'field' : a.mode === 'type' ? 'type' : 'clipboard';
  if (how === 'field' && !src.origin) throw bad(`"${src.label}" has no site, and a secret is filled into a web page only on its own site: give it one in Field → Connectors.`);
  // A secret with a site goes only into that site's field: typed or pasted, any window (or a look-alike page) could take it.
  if (how !== 'field' && src.origin) throw bad(`"${src.label}" belongs to ${src.origin}: it is filled only into a field on that site (ref from browser_snapshot in the person's browser), never typed or pasted.`);
  const payload = { how, value: src.value, uses: how === 'clipboard' ? clamp(a.uses, 1, 10, 1) : 1, ttlSec: clamp(a.seconds, 5, 300, 30),
    ...(how === 'field' ? { ref: Number(a.ref), tab: a.tab !== undefined && a.tab !== null ? Number(a.tab) : null } : {}),
    ...(src.origin ? { origin: src.origin } : {}) };   // with a site, the device refuses anything but that site's field too
  const c = await clientOf(d);
  require('./hold').mark(d.id);   // a minute without reads from this device: before the use, so a read racing it waits too
  const scrub = t => require('../service-keys').scrub(t, src.value);
  let out;
  try { out = scrub(await c.callTool('secret_fill', { sealed: seal.seal(d.id, payload) })); }
  catch (e) { out = `Error: ${scrub(e.message)}`; }
  const target = describe(how, payload);
  const failed = /^Error:/.test(out);
  await vault.record({ secret: src.label, device: d, target, uses: payload.uses, by: person?.id, sessionId: ctx.sessionId, outcome: failed ? out.slice(0, 300) : 'done' }).catch(() => {});
  if (failed) {
    const old = /secret_fill/.test(out) && /not lent|No tool|Unknown/i.test(out);
    throw bad(old ? `${d.name}'s client is older than sealed secrets: update it (doca-client update; the browser extension from Field → API keys).` : `${d.name} did not use it: ${out.replace(/^Error:\s*/, '')}`, 502);
  }
  let r = {};
  try { r = JSON.parse(out); } catch { /* a sentence */ }
  const where = how === 'field' ? `into field [${payload.ref}] on ${payload.origin}` : how === 'type' ? 'by typing it into what has focus' : 'on its clipboard';
  const left = how !== 'clipboard' ? 'Nothing of it is kept there.'
    : r.counted === false ? `It is cleared from the clipboard in ${payload.ttlSec} s (this device cannot count pastes).`
      : `It is forgotten after ${payload.uses} paste${payload.uses === 1 ? '' : 's'} or ${payload.ttlSec} s, whichever is first.`;
  return `Used "${src.label}" on ${d.name} ${where}. ${left} You never see a secret's value; the person can see where it was used in Field → Connectors.`;
}

module.exports = { use, sourceOf, deviceOf, describe };
