'use strict';

/**
 * A notice for a person, wherever they can see it (deep test B, 2026-10-08): their own devices that can show one
 * (reach.tell, reach-shows.js) — a phone, a watch, a desk client, a linked chat — and the panel's own notices on their
 * open pages (notices/). A reminder goes to both, since the panel is one of their screens; the agent's `tell_device`
 * goes to the panel only when no device of theirs can show it. The record says exactly who got it, or that nobody
 * could and why — never "reminded on" a client that draws nothing.
 */

function deliver({ personId = null, title, text, to, files, svg, urgent, panel = 'fallback', from = 'hub', strict = false } = {}) {
  const reach = require('./reach');
  let sent = null, why = null;
  if (Array.isArray(to) && !to.length) why = 'No device or linked chat of theirs is paired.';
  else {
    try { sent = reach.tell({ to, title, text, files, svg, urgent, personId }); }
    catch (e) { if (strict && !e.unshown) throw e; why = e.message; }
  }
  const onPanel = panel === 'always' || !sent ? require('../notices').post({ personId, title, text, from }) : null;
  return { sent, why, onPanel, summary: summary({ sent, why, onPanel }) };
}

/** One sentence: where it went, and why not further. */
function summary({ sent, why, onPanel }) {
  const parts = [];
  if (sent?.delivered.length) parts.push(sent.delivered.map(d => `${d.device.name} (${d.note})`).join(', '));
  if (onPanel) parts.push(onPanel.pages ? `the panel (on ${onPanel.pages} open page${onPanel.pages === 1 ? '' : 's'})` : 'the panel (no page open: it waits there until they open one)');
  const head = parts.length ? `Sent to ${parts.join(' and ')}.` : 'Nobody could be shown it.';
  return why ? `${head} ${why}` : head;
}

/** A reminder's devices: this person's own, by `userId` alone (never the hive's), or the one they named. */
function ownIds(personId, device) {
  return require('../api-v1/devices').list()
    .filter(d => !d.revokedAt && personId && d.userId === personId && (!device || d.id === device || d.name === device)).map(d => d.id);
}

/** Where a reminder for this person would show now, in words: for the answer made before it fires (`remind`). */
function where(personId, device) {
  const ids = ownIds(personId, device);
  if (!ids.length) return 'on the panel only (no device or linked chat of theirs is paired)';
  try { return `on ${require('./reach').ownTargets(ids, personId).map(d => d.name).join(', ')} and on the panel`; }
  catch (e) { return `on the panel only (${e.message.replace(/\.$/, '')})`; }
}

module.exports = { deliver, summary, where, ownIds };
