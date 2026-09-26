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
const toolcheck   = require('./toolcheck');
const environment = require('./environment');
const installs    = require('./installs');
const registry    = require('../agents/registry');
const missions    = require('../agents/missions');
const settings    = require('./settings');
const approval    = require('./approval');
const organization = require('./organization');

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

/**
 * GET /api/harness/tool-check?provider=…&model=…
 *
 * Whether a model will call a tool. A read, deliberately: it changes no
 * setting, spends one 64-token call, and is exactly the question the agent
 * should be able to ask about its own fallback — so it is not behind
 * `requireBrowser`, which exists for routes that apply something.
 */
const handleToolCheck = wrap(async (req, res) =>
  res.json(await toolcheck.check({
    provider: req.query.provider,
    model:    req.query.model,
    // No signal from the request: Express 4 has no `req.signal`, and the check
    // carries its own deadline, so a panel that goes away costs one abandoned
    // 64-token call rather than a socket held open indefinitely.
  })));

const handleStatus = wrap(async (req, res) => res.json(await agent.status({ sessionId: req.query.sessionId })));

/** GET /api/harness/usage?days=7&by=day|model|provider|session|agent|kind */
const handleUsage = wrap(async (req, res) =>
  res.json(require('./usage').summary({ days: req.query.days, by: req.query.by || 'day' })));

/* ── Approvals ────────────────────────────────────────── */

/** GET /api/harness/approval — the mode, the standing allowlist, what is waiting. */
const handleApproval = wrap(async (_req, res) =>
  res.json({ ...approval.settings(), pending: approval.pending(), free: [...approval.FREE] }));

/** POST /api/harness/approval — set the mode. Only ever from a click. */
const handleApprovalMode = wrap(async (req, res) => {
  const r = approval.setMode(req.body?.mode, { role: req.auth?.role || 'owner', confirm: req.body?.confirm });
  require('../auth/store').audit({ orgId: req.auth?.orgId, actorId: req.auth?.user.id, action: `approval mode: ${r.mode}` });
  res.json(r);
});

/** POST /api/harness/approvals/:id — answer one waiting request. */
const handleApprovalDecide = wrap(async (req, res) => {
  const ok = approval.decide(req.params.id, req.body?.decision);
  // Gone rather than never-there: a question withdraws itself on timeout and
  // when the turn is stopped, so a click landing late is ordinary, not an error
  // to shout about.
  if (!ok) return res.status(409).json({ error: 'That request is no longer waiting for an answer.' });
  res.json({ ok: true, ...approval.settings() });
});

/** DELETE /api/harness/approval/always/:key — take back a standing allowance. */
const handleApprovalForget = wrap(async (req, res) => res.json(approval.forget(req.params.key)));

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

const handleSessions = wrap(async (_req, res) => {
  const main = memory.mainSession();
  const data = memory.listSessions();
  res.json({ main: main.id, active: data.active || main.id, sessions: data.sessions.map(organization.view) });
});

const handleSessionNew = wrap(async (req, res) => {
  const session = organization.create(req.body || {});
  memory.setActive(session.id);
  res.json({ session });
});

const handleSession = wrap(async (req, res) => {
  const session = memory.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Unknown session' });
  res.json({ session: { ...session, ...organization.view(session) }, messages: memory.messages(req.params.id) });
});

const handleSessionArchive = wrap(async (req, res) =>
  res.json({ session: organization.archive(req.params.id, req.body?.on !== false) }));
const handleSessionStop = wrap(async (req, res) =>
  res.json({ stopped: agent.cancel(req.params.id) }));
const handlePlan = wrap(async (req, res) =>
  res.json({ plan: organization.plan(req.params.id, req.body || {}, { user: true }) }));

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


/* ── Environment and settings proposals ───────────────── */

/** What the agent is told about this machine, verbatim, so the user can read it. */
const handleEnvironment = wrap(async (req, res) => {
  const id = req.query.sessionId;
  res.json({ snapshot: environment.snapshot(), block: environment.block(), charter: providers.SAFETY_CHARTER,
    // `readings` is the after-history block verbatim, so it carries the mission
    // state a turn sends as well — by the same helper the turn uses, which keeps
    // this view honest for the levels that are told and silent for those that
    // are not (a specialist is inside one errand, not running the board).
    ...(id ? { prompt: agent.preview({ sessionId: id }),
      readings: [organization.block(id, organization.notices(id).slice(0, 10)), agent.missionsFor(id)]
        .filter(Boolean).join('\n'),
      context: agent.breakdown({ sessionId: id }) } : {}) });
});

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

// Markdown (the editor's format, agents/markdown.js) or the older JSON fields.
const handleAgentSave = wrap(async (req, res) => {
  const def = req.body?.markdown ? require('../agents/markdown').parse(req.body.markdown, { fallbackId: req.params.id }) : req.body;
  res.json({ ok: true, agent: registry.save({ ...def, id: req.params.id || def?.id }) });
});

const handleAgentDelete = wrap(async (req, res) =>
  res.json({ ok: true, agent: registry.remove(req.params.id) }));

const handleMissions = wrap(async (req, res) =>
  res.json({ missions: missions.list({ state: req.query.state, limit: Number(req.query.limit) || 50,
    all: req.query.all === '1' }) }));

/** POST /api/harness/missions/:id/archive - put a finished one away, or bring it back. */
const handleMissionArchive = wrap(async (req, res) =>
  res.json({ ok: true, mission: missions.archive(req.params.id, { on: req.body?.archived !== false }) }));

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
  handleSessionArchive, handleSessionStop, handlePlan,
  handleAgents, handleAgentsEnable, handleAgentSave, handleAgentDelete, handleMissions, handleMission, handleMissionArchive,
  handleInstalls, handleInstallApply, handleInstallReject,
  handleList, handleSetDefault, handleInstall, handleConfig, handleAddCustom, handleRemoveCustom,
  handleProviders, handleModels, handleToolCheck, handleStatus, handleUsage,
  handleChat, handleSessions, handleSessionNew, handleSession, handleSessionActivate, handleSessionDelete,
  handleMemoryList, handleMemoryWrite, handleMemoryForget, handleMemoryLock, handleMemoryFlag,

  handleEnvironment, handlePromptSize, handleSettingsRead, handleProposals, handleProposalApply, handleProposalReject,
  handleApproval, handleApprovalMode, handleApprovalDecide, handleApprovalForget,
};
