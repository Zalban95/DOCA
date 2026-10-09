'use strict';

/**
 * Settings → General → Updates in a production hive (public/js/settings/update-channel.js):
 *
 *   GET  /api/update/channel          what the channel found, the settings, what an update waits on
 *   POST /api/update/channel          {auto: off|notify|window, days: [mon…], from: HH:MM, to: HH:MM}
 *   POST /api/update/channel/check    ask the licence server now
 *   POST /api/update/channel/apply    "Update now": staged at once, switched to as soon as nothing runs
 *   POST /api/update/channel/cancel   call a waiting update off
 *
 * And /api/update-check answers from the channel in production (checkView), so the header's ⬆ and an older page's
 * check read the same thing. A development hive answers 409 here: it updates from git.
 */
const ch = require('./index');

const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });
const dev = res => res.status(409).json({ error: 'A development hive updates from git (Settings → General → Updates).', development: true });

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

function saveSettings(b = {}) {
  const patch = {};
  if (b.auto !== undefined) { if (!['off', 'notify', 'window'].includes(b.auto)) throw new Error('auto is off, notify or window.'); patch.auto = b.auto; }
  if (b.days !== undefined) {
    if (!Array.isArray(b.days) || b.days.some(d => !ch.DAYS.includes(d))) throw new Error(`days is a list of ${ch.DAYS.join(', ')}.`);
    patch.days = ch.DAYS.filter(d => b.days.includes(d));
  }
  for (const k of ['from', 'to']) if (b[k] !== undefined) { if (!HHMM.test(String(b[k]))) throw new Error(`${k} is a time of day, HH:MM.`); patch[k] = String(b[k]).padStart(5, '0'); }
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, updates: { ...(prefs.updates || {}), ...patch } });
  return ch.status();
}

/** /api/update-check's answer in production, from the channel. */
async function checkView(force) {
  const s = force ? await ch.check() : ch.status();
  const latest = s.latest?.version || null;
  return { current: s.running, latest, checked: !!s.lastCheck && !s.lastError, source: 'the update channel',
    reason: s.lastError || (s.channel.ok ? null : s.channel.why), updateAvailable: !!latest, urgent: s.urgent, production: true, checkedAt: s.lastCheck };
}

function mount(app) {
  app.get('/api/update/channel', (req, res) => (ch.status().production ? res.json(ch.status()) : dev(res)));
  app.post('/api/update/channel', (req, res) => { if (!ch.status().production) return dev(res); try { res.json(saveSettings(req.body)); } catch (e) { fail(res, e); } });
  app.post('/api/update/channel/check', async (req, res) => { if (!ch.status().production) return dev(res); res.json(await ch.check()); });
  app.post('/api/update/channel/apply', async (req, res) => { if (!ch.status().production) return dev(res); try { res.json(await ch.now()); } catch (e) { fail(res, e); } });
  app.post('/api/update/channel/cancel', (req, res) => { if (!ch.status().production) return dev(res); res.json(ch.cancel()); });
}

module.exports = { mount, checkView, saveSettings };
