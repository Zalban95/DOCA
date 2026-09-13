'use strict';

/**
 * HTTP surface for harnesses: the catalog rows the Controls page draws, and
 * the console (chat, sessions, memory) of the built-in one.
 */
const { sseHeaders } = require('../utils');
const catalog   = require('./catalog');
const providers = require('./providers');
const memory      = require('./memory');
const tools       = require('./tools');
const agent       = require('./agent');
const environment = require('./environment');
const settings    = require('./settings');

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
      // The browser tags itself too: "who is asking" must never be missing, or
      // the agent would answer a watch the way it answers a 27-inch monitor.
      client: { name: 'Dashboard console', kind: 'dashboard', formFactor: 'desktop',
                label: 'the dashboard in a desktop browser, next to every panel you can read',
                input: { text: true, touch: false } },
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

const handleRulesGet = wrap(async (_req, res) =>
  res.json({ rules: memory.rules(), defaults: memory.DEFAULT_RULES }));

const handleRulesWrite = wrap(async (req, res) =>
  res.json({ ok: true, rules: memory.rulesWrite({ ...req.body, source: 'user' }) }));

const handleRulesReset = wrap(async (_req, res) =>
  res.json({ ok: true, rules: memory.rulesReset() }));

/**
 * POST /api/harness/memory/rules/verify — read the rules for sense, change nothing.
 *
 * Both sides write these rules, which is the point of them and also the risk: a
 * rule the agent added months ago can contradict one the user just typed, name a
 * category that no longer exists, or be so vague that following it is a coin
 * toss. Nobody notices, because the file is only ever read by a model.
 *
 * So this asks a model to review them — with no tools, no memory and no
 * conversation (`agent.ask`), because reviewing text is not a job that needs
 * authority — and returns findings and questions. **It never writes.** A rule is
 * the user's to change (Rules modal) or the agent's (`memory_rules_write`); a
 * reviewer that edited them would be a third author nobody asked for.
 */
const handleRulesVerify = wrap(async (req, res) => {
  const doc = memory.rules();
  const proposed = req.body && typeof req.body === 'object' && (req.body.rules || req.body.categories)
    ? { categories: req.body.categories || doc.categories, rules: req.body.rules || doc.rules }
    : doc;

  const catalogue = proposed.categories.map(c => `- ${c.id}${c.description ? `: ${c.description}` : ''}`).join('\n');
  const listing   = proposed.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const system = [
    'You review a short rulebook that another assistant follows when it decides what to write into its',
    'long-term memory. Judge only the rules as written.',
    '',
    'Report, in this order and nothing else:',
    'CONFLICTS — pairs of rules that cannot both be followed. Name them by number.',
    'UNCLEAR — rules whose meaning depends on a judgement the rule does not define, with the wording that is vague.',
    'GAPS — a category with no rule about when to use it, or a rule referring to a category that is not listed.',
    'QUESTIONS — up to three questions for the person who owns these rules, each one a question whose answer would',
    'let a rule be rewritten precisely. Ask nothing you could answer from the rules themselves.',
    '',
    'One line per finding, starting with the rule number. Write "none" under a heading with no findings.',
    'Do not rewrite the rules, do not propose replacement text, and do not comment on anything outside them.',
  ].join('\n');

  const review = await agent.ask({
    system,
    user: `Categories:\n${catalogue || '(none)'}\n\nRules:\n${listing || '(none)'}`,
    maxTokens: 900,
  });

  res.json({
    ok: true,
    checked: { categories: proposed.categories.length, rules: proposed.rules.length },
    // By content, not by identity: the Rules modal always posts its textareas,
    // so an unedited draft is a different object saying the same thing, and
    // telling the user their saved rules are "unsaved" is a small lie.
    saved: JSON.stringify([proposed.categories, proposed.rules]) === JSON.stringify([doc.categories, doc.rules]),
    review,
  });
});

/* ── Environment and settings proposals ───────────────── */

/** What the agent is told about this machine, verbatim, so the user can read it. */
const handleEnvironment = wrap(async (_req, res) =>
  res.json({ snapshot: environment.snapshot(), block: environment.block(), charter: providers.SAFETY_CHARTER }));

const handleSettingsRead = wrap(async (_req, res) =>
  res.json({ settings: settings.readable(), sections: settings.SETTABLE }));

const handleProposals = wrap(async (_req, res) => res.json(settings.list()));

const handleProposalApply = wrap(async (req, res) =>
  res.json({ ok: true, ...settings.apply(req.params.id) }));

const handleProposalReject = wrap(async (req, res) =>
  res.json({ ok: true, proposal: settings.reject(req.params.id, req.body?.reason) }));

module.exports = {
  handleList, handleSetDefault, handleInstall, handleConfig, handleAddCustom, handleRemoveCustom,
  handleProviders, handleModels, handleStatus,
  handleChat, handleSessions, handleSessionNew, handleSession, handleSessionActivate, handleSessionDelete,
  handleMemoryList, handleMemoryWrite, handleMemoryForget,
  handleRulesGet, handleRulesWrite, handleRulesReset, handleRulesVerify,
  handleEnvironment, handleSettingsRead, handleProposals, handleProposalApply, handleProposalReject,
};
