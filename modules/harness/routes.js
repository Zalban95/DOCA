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
const installs    = require('./installs');
const registry    = require('../agents/registry');
const missions    = require('../agents/missions');
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
  // The console is the user, and the user may delete anything, locked included —
  // the lock exists to stop the agent, not its author.
  memory.memForget(req.params.key, { source: 'user' });
  res.json({ ok: true });
});

/**
 * POST /api/harness/memory/:key/lock — settle a fact, or unsettle it.
 *
 * The one asymmetry in this memory: both sides write it, but only this route
 * locks. A locked entry is the user's answer to something that has already been
 * argued about, and the agent can dispute it (`memory_flag`) without being able
 * to overwrite it — the same shape as a settings proposal, for the same reason.
 */
const handleMemoryLock = wrap(async (req, res) =>
  res.json({ ok: true, entry: memory.memLock(req.params.key, req.body?.locked !== false) }));

/** POST /api/harness/memory/:key/flag — the user recording a contradiction too. */
const handleMemoryFlag = wrap(async (req, res) =>
  res.json({ ok: true, entry: memory.memDispute(req.params.key, { note: req.body?.note, source: 'user' }) }));

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

/**
 * Where the tokens go, so "my prompt is 135k" stops being a mystery.
 *
 * The percentage warnings answer "will it fit"; this answers "what is it made
 * of", which is the question when the window is a million tokens and the bill
 * is per step.
 */
const handlePromptSize = wrap(async (req, res) =>
  res.json(agent.breakdown({ message: String(req.query.message || ''), sessionId: req.query.sessionId || null })));

const handleSettingsRead = wrap(async (_req, res) =>
  res.json({ settings: settings.readable(), sections: settings.SETTABLE }));

const handleProposals = wrap(async (_req, res) => res.json(settings.list()));

const handleProposalApply = wrap(async (req, res) =>
  res.json({ ok: true, ...settings.apply(req.params.id) }));

const handleProposalReject = wrap(async (req, res) =>
  res.json({ ok: true, proposal: settings.reject(req.params.id, req.body?.reason) }));

/* ── Specialist agents and their missions ─────────────── */

const handleAgents = wrap(async (_req, res) =>
  res.json({ enabled: registry.enabled(), dir: registry.dir(), agents: registry.list(), never: registry.NEVER }));

/** The switch. Off is the default, and turning it off is the rollback. */
const handleAgentsEnable = wrap(async (req, res) =>
  res.json({ ok: true, enabled: registry.setEnabled(req.body?.enabled === true) }));

const handleAgentSave = wrap(async (req, res) =>
  res.json({ ok: true, agent: registry.save({ ...req.body, id: req.params.id || req.body?.id }) }));

const handleAgentDelete = wrap(async (req, res) =>
  res.json({ ok: true, agent: registry.remove(req.params.id) }));

const handleMissions = wrap(async (req, res) =>
  res.json({ missions: missions.list({ state: req.query.state, limit: Number(req.query.limit) || 50 }) }));

const handleMission = wrap(async (req, res) => {
  const m = missions.get(req.params.id);
  if (!m) return res.status(404).json({ error: `No mission called "${req.params.id}"` });
  res.json({ mission: m, events: missions.events(req.params.id) });
});

/* ── Install proposals ────────────────────────────────── */

const handleInstalls = wrap(async (_req, res) => res.json({ ...installs.list(), kinds: installs.kinds() }));

/** The click. Streams nothing: the installers it wraps already report at the end. */
const handleInstallApply = wrap(async (req, res) =>
  res.json({ ok: true, install: await installs.apply(req.params.id, { password: req.body?.password }) }));

const handleInstallReject = wrap(async (req, res) =>
  res.json({ ok: true, install: installs.reject(req.params.id, req.body?.reason) }));

module.exports = {
  handleAgents, handleAgentsEnable, handleAgentSave, handleAgentDelete, handleMissions, handleMission,
  handleInstalls, handleInstallApply, handleInstallReject,
  handleList, handleSetDefault, handleInstall, handleConfig, handleAddCustom, handleRemoveCustom,
  handleProviders, handleModels, handleStatus,
  handleChat, handleSessions, handleSessionNew, handleSession, handleSessionActivate, handleSessionDelete,
  handleMemoryList, handleMemoryWrite, handleMemoryForget, handleMemoryLock, handleMemoryFlag,
  handleRulesGet, handleRulesWrite, handleRulesReset, handleRulesVerify,
  handleEnvironment, handlePromptSize, handleSettingsRead, handleProposals, handleProposalApply, handleProposalReject,
};
