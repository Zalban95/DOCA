'use strict';

/**
 * A skill attached to one message (asked 2026-10-09): the composer's chip — "<product> suggests: X" — tapped, or, with
 * auto-accept on, every skill the message names by a trigger (skill-triggers.js). Unlike a skill attached to the chat
 * (skill-use.js, a block in the system prompt), this one is for this request only, so it is written once into the
 * person's own row at the start of the turn (`attachedSkills` on the row, rendered after its text by
 * turn/messages.js, the way an attachment's note is): it travels as history from then on, cached with the rest of the
 * transcript, and is never re-sent in the uncached tail of each step.
 *
 *   session.skillsNext  { add: [names], skip: [names] } — what the chip asked for the next message; read and cleared
 *                       by the turn that takes it
 *   session.skillAuto   true | false | null — this chat's auto-accept; null: on in a project conversation in Agent
 *                       mode, else the hive's `skillSuggest.autoAccept` (off)
 */
const memory = require('./memory');

const MAX_TEXT = 6000;
const brand = () => { try { return require('../branding').name('product'); } catch { return 'the hub'; } };
const names = v => (Array.isArray(v) ? v : []).map(String).filter(n => /^[a-z0-9][a-z0-9-]{0,63}$/.test(n)).slice(0, 10);

/** Whether a triggered suggestion is attached without a tap in this conversation, and why. */
function auto(sessionId) {
  const s = memory.getSession(sessionId);
  if (s?.skillAuto === true || s?.skillAuto === false) return { on: s.skillAuto, from: 'this chat' };
  let project = null;
  try { project = require('../projects/store').forSession(sessionId); } catch { /* none */ }
  if (project && require('./modes').of(sessionId) === 'agent') return { on: true, from: 'a project chat in Agent mode' };
  return { on: !!require('../settings-schema').value('skillSuggest.autoAccept'), from: 'Settings → Harness → Skills' };
}

/** What the chip asked for the next message: `add` names to attach, `skip` names auto-accept must leave out. */
function set(sessionId, v = {}) {
  if (!memory.getSession(sessionId)) throw Object.assign(new Error('Unknown conversation'), { status: 404 });
  const was = memory.getSession(sessionId).skillsNext || {};
  const add = [...new Set([...(was.add || []), ...names(v.add)])].filter(n => !names(v.skip).includes(n) && !names(v.unadd).includes(n));
  const skip = [...new Set([...(was.skip || []), ...names(v.skip)])].filter(n => !names(v.add).includes(n));
  memory.updateSession(sessionId, { skillsNext: add.length || skip.length ? { add, skip } : null });
  return { add, skip };
}

/**
 * At the start of a turn: the skills for this message — the chip's, and with auto-accept the triggered ones not
 * skipped or already attached to the chat — written onto the person's row once. Returns the names.
 */
function insert(sessionId) {
  const s = memory.getSession(sessionId);
  if (!s) return [];
  const next = s.skillsNext || {};
  if (s.skillsNext) memory.updateSession(sessionId, { skillsNext: null });
  const rows = memory.messages(sessionId);
  const row = [...rows].reverse().find(r => r.role === 'user');
  if (!row || row.attachedSkills) return [];
  const onChat = require('./skill-use').resolve(sessionId).skills.map(x => x.name);   // in the system prompt already
  const want = [...(next.add || [])];
  if (auto(sessionId).on) for (const m of require('./skill-triggers').match(row.content, { skip: [...onChat, ...(next.skip || [])] })) want.push(m.name);
  const list = [...new Set(want)].filter(n => !onChat.includes(n));
  const attached = [];
  for (const name of list) {
    try { attached.push({ name, text: require('./skills').read(name).body.trim().slice(0, MAX_TEXT) }); } catch { /* gone: left out */ }
  }
  if (!attached.length) return [];
  const docs = require('../db/docs'), path = require('path');
  const file = path.join(require('../store').dir('harness/sessions'), `${sessionId}.jsonl`);
  docs.editLast(`transcript:${sessionId}`, file, r => (r.role === 'user' && r.at === row.at && !r.attachedSkills ? { ...r, attachedSkills: attached } : null), 8);
  return attached.map(a => a.name);
}

/** How a row's skills read to the model, after the person's words ('' for none). */
function note(row) {
  if (!row?.attachedSkills?.length) return '';
  return row.attachedSkills.map(a => `\n\n[${brand()} attached the skill ${a.name} to this request — follow it]\n# ${a.name}\n${a.text}`).join('');
}

module.exports = { auto, set, insert, note };
