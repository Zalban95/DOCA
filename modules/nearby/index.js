'use strict';

/**
 * Nearby (asked 2026-10-12): the things around this hub — Cast speakers and TVs, Bonjour services, UPnP/DLNA players,
 * the network's neighbours, Bluetooth devices, Home Assistant's entities, the tailnet's machines — seen by the
 * sources a person switches on (scan.js), one row per thing whichever saw it (merge.js), and saved with a name, a
 * place and a room of their own (store.js) so the agent knows what is where and how to use it (`nearby` tool,
 * turn/fits.js). Not "devices": those are DOCA's paired clients. Machines → Nearby; absent on a hosted hive.
 *
 *   GET    /api/machines/nearby                  sources, seen, saved, places, last scan, schedule
 *   POST   /api/machines/nearby/sources          {id, on}         a source's switch
 *   POST   /api/machines/nearby/schedule         {everyMin}       scan by itself (0: never)
 *   POST   /api/machines/nearby/scan             {only?}          look now
 *   POST   /api/machines/nearby/saved            {seenId, name, place, room}
 *   PUT    /api/machines/nearby/saved/:id        {name, place, room, kind}
 *   DELETE /api/machines/nearby/saved/:id        (the page offers Undo, POST …/saved/restore)
 *   POST   /api/machines/nearby/saved/restore    {thing}
 *   DELETE /api/machines/nearby/seen/:id         forget one until it is seen again
 *   POST   /api/machines/nearby/pair             {address}        Bluetooth, after the person's confirmation (Linux)
 *   POST   /api/machines/nearby/pair/answer      {address, answer}
 *   GET    /api/machines/nearby/export · POST /api/machines/nearby/import
 * All of /api/machines is host (auth/rights.js).
 */
const scan = require('./scan');
const store = require('./store');

function view() {
  return { sources: scan.sources(), seen: store.seen(), saved: store.saved(), places: store.places(), lastScan: store.lastScan(), scanning: scan.scanning(),
    everyMin: require('../settings-schema').value('nearby.everyMin'), platform: process.platform };
}

/** Whether there is anything for the agent: a source on, or something seen or saved. */
const any = () => scan.SOURCES.some(s => scan.isOn(s.id)) || store.seen().length > 0 || store.saved().length > 0;

function setPref(path, value) {
  const u = require('../utils');
  const prefs = u.loadPrefs();
  const parts = path.split('.');
  let o = prefs;
  for (const p of parts.slice(0, -1)) o = (o[p] && typeof o[p] === 'object') ? o[p] : (o[p] = {});
  o[parts.at(-1)] = value;
  u.savePrefs(prefs);
}

/* ── By itself, when the person set it ── */
let timer = null, last = 0;
function tick() {
  const every = require('../settings-schema').value('nearby.everyMin');
  if (!every || Date.now() - last < every * 60000 || scan.scanning()) return;
  last = Date.now();
  scan.scan({ why: `every ${every} minutes, as set in Machines → Nearby` }).catch(() => {});
}
function start() {
  if (timer || require('../hosted').on()) return;
  last = Date.now();
  timer = setInterval(tick, 60000);
  timer.unref?.();
}

function mount(app) {
  const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
  const who = req => { const u = req.auth?.user; return u ? { id: u.id, name: u.name || u.email } : null; };
  app.get('/api/machines/nearby', (req, res) => { try { res.json(view()); } catch (e) { fail(res, e); } });
  app.post('/api/machines/nearby/sources', (req, res) => {
    const { id, on } = req.body || {};
    if (!scan.SOURCES.some(s => s.id === id)) return res.status(400).json({ error: `No source "${id}". One of: ${scan.SOURCES.map(s => s.id).join(', ')}.` });
    setPref(`nearby.sources.${id}`, on === true);
    res.json(view());
  });
  app.post('/api/machines/nearby/schedule', (req, res) => {
    const n = Number(req.body?.everyMin);
    if (!Number.isInteger(n) || n < 0 || n > 1440) return res.status(400).json({ error: 'Minutes between scans: a whole number from 0 (never) to 1440.' });
    setPref('nearby.everyMin', n);
    last = Date.now();
    res.json(view());
  });
  app.post('/api/machines/nearby/scan', async (req, res) => {
    try {
      const only = Array.isArray(req.body?.only) ? req.body.only.map(String) : null;
      const r = await scan.scan({ only, why: 'a person pressed Scan', person: who(req) });
      res.json({ ...view(), found: r.found, bySource: r.bySource, why: r.why, none: !!r.none });
    } catch (e) { fail(res, e); }
  });
  app.post('/api/machines/nearby/saved', (req, res) => { try { res.status(201).json(store.save({ ...req.body, id: undefined })); } catch (e) { fail(res, e); } });
  app.post('/api/machines/nearby/saved/restore', (req, res) => { try { res.json(store.restore(req.body?.thing)); } catch (e) { fail(res, e); } });
  app.put('/api/machines/nearby/saved/:id', (req, res) => { try { res.json(store.save({ ...req.body, id: req.params.id, seenId: undefined })); } catch (e) { fail(res, e); } });
  app.delete('/api/machines/nearby/saved/:id', (req, res) => { try { res.json(store.remove(req.params.id)); } catch (e) { fail(res, e); } });
  app.delete('/api/machines/nearby/seen/:id', (req, res) => { try { res.json(store.forget(req.params.id)); } catch (e) { fail(res, e); } });
  app.post('/api/machines/nearby/pair', async (req, res) => {
    const address = String(req.body?.address || '');
    const r = await require('./bluetooth').pair(address);
    require('../activity').note({ from: 'nearby', what: `paired Bluetooth ${address}: ${r.state}`, why: 'a person pressed Pair and confirmed', person: who(req),
      machine: { kind: 'bluetooth', id: address }, act: 'pair', ok: r.state === 'paired' ? true : r.state === 'failed' ? false : null });
    res.json(r);
  });
  app.post('/api/machines/nearby/pair/answer', async (req, res) => { res.json(await require('./bluetooth').answer(req.body?.address, req.body?.answer)); });
  app.get('/api/machines/nearby/export', (req, res) => { res.set('Content-Disposition', 'attachment; filename="nearby-things.json"').json(store.exportAll()); });
  app.post('/api/machines/nearby/import', (req, res) => { try { res.json(store.importAll(req.body)); } catch (e) { fail(res, e); } });
}

module.exports = { mount, view, any, start, tick };
