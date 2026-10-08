'use strict';

/**
 * A conversation as a chat tab sees it (asked 2026-10-04: tabs with a mode, an
 * approval switch and a model each): its settings, and the messages waiting
 * for it (inbox.js) — shown folded beside the chat, each one withdrawable.
 *
 *   POST   /api/harness/sessions/:id/settings   { title?, mode?, approval?: 'auto'|'manual'|null, thinking?: 'auto'|'off'|'on'|level }
 *   GET    /api/harness/sessions/:id/inbox
 *   DELETE /api/harness/sessions/:id/inbox/:qid
 *
 * The approval switch is what lets the agent act unasked, so only a host sets
 * it (auth/rights.js says the same of the panel's own switch); the rest is the
 * conversation's owner's, like the conversation itself (session-access.js).
 */
const memory = require('./memory');

const who = req => req.auth && { ...req.auth.user, role: req.auth.role };
const handle = fn => (req, res) => {
  try { require('./session-access').check(who(req), req.params.id); res.json(fn(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

function settings(req) {
  const id = req.params.id, b = req.body || {};
  if (b.title !== undefined) {
    const title = String(b.title).replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!title) throw bad('A tab needs a name.');
    memory.updateSession(id, { title, titleLocked: true });
  }
  if (b.mode !== undefined) require('./modes').set(id, String(b.mode));
  if (b.approval !== undefined) {
    if (!require('../auth/rights').can(req.auth?.role, 'host'))
      throw bad('Whether this conversation asks before it acts is a host\'s switch.', 403);
    if (![null, 'auto', 'manual'].includes(b.approval)) throw bad('approval is auto, manual or null (the panel\'s).');
    memory.updateSession(id, { approval: b.approval });
  }
  // The composer's 💭: auto (the mode's setting), off, on (the mode's level, else medium) or a level (turn/thinking.js).
  if (b.thinking !== undefined) {
    const thinking = require('./turn/thinking');
    if (![null, ...thinking.CHOICES, 'on'].includes(b.thinking)) throw bad('thinking is auto, off, on, low, medium or high.');
    const level = thinking.toggleLevel(b.thinking, thinking.modeOf({ session: memory.getSession(id) }));
    memory.updateSession(id, { effort: level, effortBy: level ? 'toggle' : null });
  }
  return require('./organization').view(memory.getSession(id));
}

function mount(app) {
  app.post('/api/harness/sessions/:id/settings', handle(settings));
  // What the fold beside a chat shows: what is waiting, and the plan with its progress.
  app.get('/api/harness/sessions/:id/inbox', handle(req => ({ waiting: require('./inbox').waiting(req.params.id),
    plan: memory.getSession(req.params.id)?.plan || null })));
  app.delete('/api/harness/sessions/:id/inbox/:qid', handle(req => {
    require('./inbox').withdraw(req.params.id, req.params.qid);
    return { waiting: require('./inbox').waiting(req.params.id) };
  }));
}

module.exports = { mount };
