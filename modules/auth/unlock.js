'use strict';

/**
 * One password for a while (the owner's yes of 2026-10-13, a loosening of CONSTITUTION S14 asked for by name).
 *
 * The password typed for a guarded switch (guarded.js) may open this session for a short time, so that:
 *   chain    one click that flips several switches asks once — the panel sends `X-Doca-Unlock: chain` with every
 *            password, and the session stays open CHAIN_SEC after it;
 *   minutes  the person chose "Keep it unlocked for" 1, 5, 15 or 30 minutes in the password question.
 * Kept in this process's memory only, by the session's hash — a restart, a sign-out or Lock now (DELETE
 * /api/auth/unlock) ends it, and nothing is written to disk. Without the header (an older page, a script, a test) a
 * correct password opens nothing, exactly as before. The panel shows "Unlocked until hh:mm" with Lock now while it lasts.
 */
const CHOICES = [1, 5, 15, 30];
const CHAIN_SEC = 30;
const open = new Map();   // session hash → epoch ms the session stays open until

/** What `X-Doca-Unlock` asks for, in ms from now, or 0 for nothing. */
function asked(header) {
  const v = String(header || '').trim().toLowerCase();
  if (v === 'chain') return CHAIN_SEC * 1000;
  const m = Number(v);
  return CHOICES.includes(m) ? m * 60e3 : 0;
}

/** After a correct password: open the session as the header asks; never shortens a window already open. */
function grant(hash, header, now = Date.now()) {
  const ms = asked(header);
  if (!hash || !ms) return null;
  const until = Math.max(now + ms, open.get(hash) || 0);
  open.set(hash, until);
  return until;
}

/** Until when this session is open, or null. */
function until(hash, now = Date.now()) {
  const t = open.get(hash);
  if (!t) return null;
  if (t <= now) { open.delete(hash); return null; }
  return t;
}

function lock(hash) { open.delete(hash); }

/** GET (how long it stays open) and DELETE (Lock now) /api/auth/unlock — the caller's own session only. */
function mount(app) {
  const hashOf = req => req.auth?.session?.hash;
  const view = req => { const t = until(hashOf(req)); return { until: t ? new Date(t).toISOString() : null, choices: CHOICES }; };
  app.get('/api/auth/unlock', (req, res) => res.json(view(req)));
  app.delete('/api/auth/unlock', (req, res) => { lock(hashOf(req)); res.json(view(req)); });
}

module.exports = { CHOICES, CHAIN_SEC, asked, grant, until, lock, mount, _open: open };
