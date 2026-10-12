'use strict';

/**
 * A harness switched off, or taken away (asked 2026-10-12: "add the possibility to disable and delete harnesses,
 * excluded the main one"). DOCA's own harness is neither: it is the panel.
 *
 * Disabled (`harness.disabled`, a list of ids): installed and kept, but not chosen — not the default (a disabled
 * default falls back to DOCA's own), not offered to teams (harness-teams), not asked by a one-shot chat. Reversible,
 * one click either way.
 *
 * Deleted: a harness the person added is taken out of the catalogue (catalog.removeCustom); an installed one is
 * uninstalled with the exact reverse of its own installer — `npm install -g X` → `npm uninstall -g X`, and pipx, uv
 * and Homebrew likewise — never a command guessed for an installer script, which the panel cannot undo: that one is
 * said, with where its vendor tells how.
 */
const catalog = () => require('./catalog');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

function disabledIds() { return new Set(catalog().loadHarnessPrefs().disabled || []); }
const isDisabled = id => disabledIds().has(id);

function setDisabled(id, on) {
  const c = catalog(), h = c.get(id);
  if (!h) throw bad('Unknown harness', 404);
  if (h.kind === 'builtin') throw bad(`${h.label} is the panel's own harness: it cannot be switched off.`);
  const ids = disabledIds();
  if (on) ids.add(id); else ids.delete(id);
  const hp = c.loadHarnessPrefs();
  // The default switched off: DOCA's own answers again, said in the result.
  const wasDefault = on && hp.default === id;
  c.saveHarnessPrefs({ disabled: [...ids], ...(wasDefault ? { default: c.BUILTIN_ID } : {}) });
  return { id, disabled: !!on, defaultNow: wasDefault ? c.BUILTIN_ID : null };
}

const REVERSE = [
  [/^npm (?:install|i) -g (\S+)$/, m => `npm uninstall -g ${m[1]}`],
  [/^pipx install (\S+)$/, m => `pipx uninstall ${m[1]}`],
  [/^uv tool install (\S+)$/, m => `uv tool uninstall ${m[1]}`],
  [/^brew install (\S+)$/, m => `brew uninstall ${m[1]}`],
];

/** The command that undoes this harness's installer, or null when there is none the panel can run. */
function uninstallCmd(h) {
  const cmd = String(h?.installCmd || '').trim();
  for (const [re, make] of REVERSE) { const m = re.exec(cmd); if (m) return make(m); }
  return null;
}

/** What deleting would do, for the confirmation: {can, how, cmd?, why?}. */
function plan(id) {
  const h = catalog().get(id);
  if (!h) throw bad('Unknown harness', 404);
  if (h.kind === 'builtin') return { can: false, why: `${h.label} is the panel's own harness: it stays.` };
  if (h.kind === 'custom') return { can: true, how: 'remove', said: `${h.label} is taken out of the list (its command, ${h.cmd}, stays on this machine).` };
  if (h.kind === 'stack') return { can: false, why: `${h.label} is a stack: stop or remove it in its own settings (Settings → Harnesses → ${h.label}); switch it off here to keep it out of the way.` };
  const cmd = uninstallCmd(h);
  return cmd ? { can: true, how: 'uninstall', cmd, said: `${h.label} is uninstalled with ${cmd}.` }
    : { can: false, why: `${h.label} was installed by its vendor's script, which the panel cannot undo exactly: remove it as ${h.url || 'its vendor'} says, or switch it off here.` };
}

/** POST /api/harness/:id/enabled {on} */
function handleEnabled(req, res) {
  try { res.json({ ok: true, ...setDisabled(req.params.id, req.body?.on === false) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

/** GET /api/harness/:id/delete — what deleting would do. POST — does it (an uninstall streams). */
function handleDeletePlan(req, res) {
  try { res.json(plan(req.params.id)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
function handleDelete(req, res) {
  let p;
  try { p = plan(req.params.id); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  if (!p.can) return res.status(409).json({ error: p.why });
  const id = req.params.id, h = catalog().get(id);
  const done = () => {   // gone from the default, the disabled list and the activity's record alike
    const ids = disabledIds(); ids.delete(id);
    const hp = catalog().loadHarnessPrefs();
    catalog().saveHarnessPrefs({ disabled: [...ids], ...(hp.default === id ? { default: catalog().BUILTIN_ID } : {}) });
    require('../activity').note({ from: 'harness', what: `${p.how === 'remove' ? 'removed' : 'uninstalled'} ${h.label}`, why: 'a host deleted it in the panel', act: 'remove' });
  };
  if (p.how === 'remove') { catalog().removeCustom(id); done(); return res.json({ ok: true, said: p.said }); }
  require('../utils').streamCmd(res, p.cmd, { label: `Uninstalling ${h.label}`, password: typeof req.body?.password === 'string' && req.body.password ? req.body.password : undefined });
  // Recorded only when it is really gone: the command's own outcome is the stream's last frame, the check is the truth.
  res.on('finish', () => { catalog().detect(h).then(d => { if (!d.detected) done(); }).catch(() => {}); });
}

function mount(app) {
  app.post('/api/harness/:id/enabled', handleEnabled);
  app.get('/api/harness/:id/delete', handleDeletePlan);
  app.post('/api/harness/:id/delete', handleDelete);
}

module.exports = { isDisabled, setDisabled, uninstallCmd, plan, mount };
