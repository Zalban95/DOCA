'use strict';

/**
 * HTTP surface for harnesses: the catalog rows the Controls page draws, and
 * the console (chat, sessions, memory) of the built-in one.
 */
const { sseHeaders } = require('../utils');
const catalog   = require('./catalog');
const providers = require('./providers');
const memory    = require('./memory');
const tools     = require('./tools');
const agent     = require('./agent');

/** Send the thrown error with its own status when it carries one. */
function fail(res, e) {
  res.status(e.status || 500).json({ error: e.message });
}

const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { fail(res, e); } };

/* ── Catalog ──────────────────────────────────────────── */

const handleList = wrap(async (_req, res) => res.json(await catalog.list()));

const handleSetDefault = wrap(async (req, res) =>
  res.json({ ok: true, default: catalog.setDefault(req.body?.id) }));

/** POST /api/harness/:id/install — streams the vendor installer. */
function handleInstall(req, res) {
  catalog.install(res, req.params.id, req.body?.password);
}

const handleConfig = wrap(async (req, res) =>
  res.json({ ok: true, config: catalog.saveConfig(req.params.id, req.body || {}) }));

const handleAddCustom = wrap(async (req, res) =>
  res.json({ ok: true, harness: catalog.addCustom(req.body || {}) }));

const handleRemoveCustom = wrap(async (req, res) => {
  catalog.removeCustom(req.params.id);
  res.json({ ok: true });
});

/* ── Model choices for the ⚙ panel ────────────────────── */

const handleProviders = wrap(async (_req, res) => res.json({
  providers: providers.list(),
  tools:     tools.describe(),
  defaults:  providers.defaultParams(),
}));

const handleModels = wrap(async (req, res) =>
  res.json(await providers.models(req.query.provider || 'ollama')));

const handleStatus = wrap(async (_req, res) => res.json(await agent.status()));

/* ── Built-in harness console ─────────────────────────── */

/** POST /api/harness/chat — one agent turn, streamed as SSE. */
async function handleChat(req, res) {
  const message = req.body?.message;
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'No message' });

  // res, not req: the request stream closes as soon as express.json() has read
  // the body, which would abort the turn before it started.
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());

  sseHeaders(res);
  const emit = evt => { try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch {} };

  try {
    const { sessionId, steps } = await agent.turn({
      message: String(message), sessionId: req.body?.sessionId, emit, signal: ctrl.signal,
    });
    emit({ type: 'done', code: 0, sessionId, steps });
  } catch (e) {
    // The stream is already open, so the failure has to travel as an event —
    // a status code here would never reach the client.
    emit({ type: 'error', text: e.message });
    emit({ type: 'done', code: 1 });
  }
  res.end();
}

const handleSessions = wrap(async (_req, res) => res.json(memory.listSessions()));

const handleSessionNew = wrap(async (req, res) =>
  res.json({ session: memory.createSession(req.body?.title) }));

const handleSession = wrap(async (req, res) => {
  const session = memory.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Unknown session' });
  res.json({ session, messages: memory.messages(req.params.id) });
});

const handleSessionActivate = wrap(async (req, res) =>
  res.json({ ok: true, active: memory.setActive(req.params.id) }));

const handleSessionDelete = wrap(async (req, res) => {
  memory.deleteSession(req.params.id);
  res.json({ ok: true });
});

const handleMemoryList = wrap(async (_req, res) => res.json({ entries: memory.memList() }));

const handleMemoryWrite = wrap(async (req, res) =>
  res.json({ ok: true, entry: memory.memWrite({ ...req.body, source: 'user' }) }));

const handleMemoryForget = wrap(async (req, res) => {
  memory.memForget(req.params.key);
  res.json({ ok: true });
});

module.exports = {
  handleList, handleSetDefault, handleInstall, handleConfig, handleAddCustom, handleRemoveCustom,
  handleProviders, handleModels, handleStatus,
  handleChat, handleSessions, handleSessionNew, handleSession, handleSessionActivate, handleSessionDelete,
  handleMemoryList, handleMemoryWrite, handleMemoryForget,
};
