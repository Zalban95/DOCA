'use strict';

/**
 * Every secret value DOCA keeps that could leak into text it hands on: VNC passwords, logins' passwords, keys for
 * services, the hub's sealed secrets. Read through each owning module, never from a file here; only values of four
 * characters or more (a shorter one would match ordinary text).
 */
async function values() {
  const out = [...require('./vnc-targets/store').passwords()];
  try { const l = require('./logins'); for (const x of l.list()) out.push(l.secretOf(x.id)?.value); } catch { /* none */ }
  try { const k = require('./service-keys'); for (const x of k.list()) out.push(k.secretOf(x.name)?.value); } catch { /* none */ }
  try { const v = require('./sealed/vault'); for (const x of await v.list()) out.push((await v.reveal(x.name))?.value); } catch { /* none */ }
  return out.filter(s => typeof s === 'string' && s.length >= 4);
}

module.exports = { values };
