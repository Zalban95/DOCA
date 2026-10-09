'use strict';

/**
 * How long the hive chat keeps messages, and the one way an admin reads others' conversations.
 *
 *   prune()     messages older than `people.retainDays` go (0, the default: kept until deleted) — at start and daily,
 *               an activity line when any went. The admin's setting, never the agent's (settings-schema: propose false).
 *   exportAll(actor)  every space, member and message, for compliance: the owner's alone (rights `org`), asked with the
 *               password (auth/guarded.js) and written in the audit. Nobody else — an admin included — reads a
 *               conversation they are not in.
 */
const store = require('./store');

async function prune(now = Date.now()) {
  let days = 0;
  try { days = Number(require('../settings-schema').value('people.retainDays')) || 0; } catch { /* the default */ }
  if (days <= 0) return 0;
  const n = await store.prune(new Date(now - days * 864e5).toISOString());
  if (n) try { require('../activity').note({ from: 'people', what: `removed ${n} hive-chat message${n === 1 ? '' : 's'} older than ${days} days`, why: 'people.retainDays' }); } catch { /* a line, never a failure */ }
  return n;
}

let timer = null;
function start() {
  if (timer) return;
  const run = () => prune().catch(e => console.warn(`[people] keeping: ${e.message}`));
  setTimeout(run, 30e3).unref?.();
  timer = setInterval(run, 864e5);
  timer.unref?.();
}

async function exportAll(actor) {
  if (!require('../auth/rights').can(actor?.role, 'org')) throw Object.assign(new Error('The compliance export is the owner\'s alone.'), { status: 403 });
  const all = await store.everything();
  require('../auth/store').audit({ orgId: actor.orgId || null, actorId: actor.id, action: 'hive chat exported',
    detail: `${all.spaces.length} conversations, ${all.messages.length} messages` });
  return { exportedAt: new Date().toISOString(), by: actor.id, ...all };
}

module.exports = { prune, start, exportAll };
