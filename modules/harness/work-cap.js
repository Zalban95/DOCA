'use strict';

/**
 * How many background jobs one person has running at once (experiment alwaysFree; the design §3.7). No limit unless
 * the owner sets one — their answer of 2026-10-12: "no limits by default, possibility to set them; mine is just one of
 * the possible setups":
 *
 *   work.parallel    the most jobs of one person working at once; 0 (the default) none
 *   work.localSlots  opt-in: on a model server that says how many requests it serves at once (llama.cpp's slots,
 *                    kept by provider-pace.js), one fewer than it has, so the main chat always finds a slot free
 *
 * A job past the limit is lined up: its work chat exists, with its plan, in state `queued`, and starts — with the task
 * and files it was given — when one of that person's jobs ends (supervisor.js calls `next` after every turn).
 */
const memory = require('./memory');

const schema = () => require('../settings-schema');
const WORKING = ['working', 'waiting'];

/** The limit for a person now, or 0 for none. */
function limit() {
  const set = Math.max(0, Number(schema().value('work.parallel')) || 0);
  if (!schema().value('work.localSlots')) return set;
  let slots = null;
  try {
    const p = require('./agent').params();
    if (require('./providers').endpoint(p.provider)?.local) slots = require('./provider-pace').of(p.provider)?.slots || null;
  } catch { /* no provider */ }
  const local = slots ? Math.max(1, slots - 1) : 0;
  return set && local ? Math.min(set, local) : set || local;
}

const ownerOf = id => { try { return require('./session-access').ownerOf(id); } catch { return null; } };
const mine = (person, id) => (person?.id || null) === ownerOf(id);

/** That person's jobs working now. */
function working(person) {
  return memory.listSessions().sessions.filter(s => s.kind === 'work' && !s.archivedAt && WORKING.includes(s.job?.state) && mine(person, s.id)).length;
}

/**
 * A new job, when the person is at the limit: kept to start later, and `true`; else `false` (start it now). Only under
 * the experiment: without it nothing waits.
 */
function lineUp(id, { person, task, from, attachments = [], origin = null }) {
  if (!require('../experiments').on('alwaysFree')) return false;
  const max = limit();
  if (!max || working(person) < max) return false;
  memory.updateSession(id, { job: { state: 'queued', since: new Date().toISOString(), autoTurns: 0, idleTurns: 0, ...(origin ? { origin } : {}) },
    lined: { task, from, attachments, at: new Date().toISOString() } });
  require('./organization').report(id, 'progress', `Lined up: ${max} of this person's jobs are running (work.parallel${schema().value('work.localSlots') ? ', work.localSlots' : ''}); it starts when one ends.`, 'panel');
  return true;
}

/** Start what is lined up, oldest first, while each person is under the limit. @returns {string[]} the ones started */
function next() {
  const started = [];
  const lined = memory.listSessions().sessions.filter(s => s.kind === 'work' && !s.archivedAt && s.job?.state === 'queued' && s.lined)
    .sort((a, b) => String(a.lined.at).localeCompare(String(b.lined.at)));
  for (const s of lined) {
    const owner = ownerOf(s.id), person = owner ? { id: owner } : null, max = limit();
    if (max && working(person) >= max) continue;
    const { task, from, attachments } = s.lined;
    memory.updateSession(s.id, { lined: null });
    try { require('./organization').start(s.id, task, from, { attachments, origin: s.job.origin || null }); started.push(s.id); }
    catch (e) { console.warn(`[work-cap] ${s.id}: ${e.message}`); }
  }
  return started;
}

module.exports = { limit, working, lineUp, next };
