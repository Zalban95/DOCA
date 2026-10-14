'use strict';

/**
 * "Don't show this again" for a switch's notice (guarded.js; CONSTITUTION S14, 2026-10-14).
 *
 * Kept on the hub per person per switch, so it follows the person to every screen they sign in on; a password switch
 * is never hidden by it. Settings → General → "Notices before important switches" shows how many are hidden and
 * shows them all again (DELETE /api/auth/notices). Proceeding past a notice, hidden or not, is audited by the gate.
 */
const store = require('../store');

const DOC = 'switch-notices';
const all = () => store.readJson(DOC, {});

/** Whether this person chose not to see this switch's notice again. */
function hidden(userId, key) { return !!(userId && key && all()[userId]?.[key]); }

/** Remember "don't show this again" for this person and switch. */
function hide(userId, key) {
  if (!userId || !key) return;
  const a = all();
  if (a[userId]?.[key]) return;
  store.writeJson(DOC, { ...a, [userId]: { ...(a[userId] || {}), [key]: new Date().toISOString() } });
}

/** The switches this person hid, each with what it is and when. */
function list(userId) {
  const { SWITCHES } = require('./guarded');
  return Object.entries(all()[userId] || {}).filter(([k]) => SWITCHES[k]?.notice).map(([key, at]) => ({ key, what: SWITCHES[key].what, at }));
}

/** Show every notice again for this person. */
function reset(userId) {
  const a = all();
  if (!a[userId]) return 0;
  const n = Object.keys(a[userId]).length;
  delete a[userId];
  store.writeJson(DOC, a);
  return n;
}

/** GET (what is hidden) and DELETE (show them all again) /api/auth/notices — the caller's own only. */
function mount(app) {
  const uid = req => req.auth?.user?.id;
  app.get('/api/auth/notices', (req, res) => res.json({ hidden: list(uid(req)) }));
  app.delete('/api/auth/notices', (req, res) => res.json({ reset: reset(uid(req)), hidden: [] }));
}

module.exports = { hidden, hide, list, reset, mount };
