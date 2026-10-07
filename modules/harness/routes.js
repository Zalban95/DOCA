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
// A person without host sees and uses only their own conversations (session-access.js).
const access = require('./session-access');
const who = req => req.auth && { ...req.auth.user, role: req.auth.role, orgId: req.auth.orgId };
const own = handler => wrap(async (req, res) => { access.check(who(req), req.params.id); return handler(req, res); });

/* ── Catalog ──────────────────────────────────────────── */

const handleList = wrap(async (_req, res) => res.json(await catalog.list()));

const handleSetDefault = wrap(async (req, res) =>
  res.json({ ok: true, default: catalog.setDefault(req.body?.id) }));

/** POST /api/harness/:id/install — streams the vendor installer. */
function handleInstall(req, res) {
  catalog.install(res, req.params.id, req.body?.password);
}

const handleConfig = wrap(async (req, res) => {
  const config = catalog.saveConfig(req.params.id, req.body || {});
  res.json({ ok: true, config, foldWarning: catalog.get(req.params.id)?.kind === 'builtin' ? require('./fold-check').warning(config) : null });
});

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
const handleUsage = wrap(async (req, res) => {
  const summary = await require('./usage').summary({ days: req.query.days, by: req.query.by || 'day' });
  // Money only where it is meaningful: per model, from the owner's own price list (prices.js).
  res.json({ ...(summary.by === 'model' ? require('./prices').apply(summary) : summary),
    tokensPerDay: (await require('./turn/ceiling').state(require('./turn/params').params())).limit });
});

/* ── Approvals ────────────────────────────────────────── */

/** GET /api/harness/approval — the mode, the standing allowlist, what is waiting. Anyone who may chat reads the mode
 *  (the chat's Auto/Manual pill); the allowlist and every waiting question — other people's included — are a host's.
 *  A phone's session stops at what its device may do, so opening the chat there asked for the password (2026-10-05). */
const handleApproval = wrap(async (req, res) => {
  const cap = req.auth?.session?.cap;
  const host = !req.auth || (require('../auth/rights').can(req.auth.role, 'host') && (!cap || cap.includes('host')));
  if (!host) return res.json({ mode: approval.settings().mode });
  res.json({ ...approval.settings(), pending: approval.pending(), free: [...approval.FREE] });
});

/** POST /api/harness/approval — set the mode. Only ever from a click. */
const handleApprovalMode = wrap(async (req, res) => {
  const audit = action => require('../auth/store').audit({ orgId: req.auth?.orgId, actorId: req.auth?.user.id, action });
  if (typeof req.body?.recheckOutside === 'boolean') {
    approval.setRecheck(req.body.recheckOutside);
    audit(`approval: ask again after outside text ${req.body.recheckOutside ? 'on' : 'off'}`);
    if (!req.body.mode) return res.json(approval.settings());
  }
  const r = approval.setMode(req.body?.mode, { role: req.auth?.role || 'owner', confirm: req.body?.confirm });
  audit(`approval mode: ${r.mode}`);
  res.json(r);
});

/** POST /api/harness/approvals/:id — answer one waiting request. */
const handleApprovalDecide = wrap(async (req, res) => {
  // Who may answer, and what "always" and "approve all" mean for them: approval-answer.js.
  const person = req.auth && { ...req.auth.user, role: req.auth.role };
  let ok;
  try { ok = require('./approval-answer').answerAs({ id: req.params.id, decision: req.body?.decision, person }); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
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
    const opts = {
      message: String(message), emit, signal: ctrl.signal,
      sessionId: req.body?.sessionId ? (access.check(who(req), req.body.sessionId), req.body.sessionId) : access.defaultFor(who(req)),
      // The browser tags itself too: "who is asking" must never be missing, or
      // the agent would answer a watch the way it answers a 27-inch monitor.
      client: require('./turn/client').dashboardClient(req),
    };
    // A conversation that is working takes the message into its inbox (send-stream.js, inbox.js).
    const r = await require('./send-stream').sendStreamed(opts, { res, emit });
    emit({ type: 'done', code: 0, ...(r ? { sessionId: r.sessionId, steps: r.steps } : { read: true }) });
  } catch (e) {
    // The stream is already open, so the failure has to travel as an event —
    // a status code here would never reach the client.
    emit({ type: 'error', text: e.message });
    emit({ type: 'done', code: 1 });
  }
  res.end();
}

const handleSessions = wrap(async (req, res) => {
  const main = memory.mainSession(), person = who(req), data = memory.listSessions();
  if (!person?.id || access.isHost(person))
    return res.json({ main: main.id, active: data.active || main.id, sessions: data.sessions.map(organization.view) });
  res.json({ main: null, active: access.newestOwn(person), sessions: access.visible(person, data.sessions).map(organization.view) });
});

const handleSessionNew = wrap(async (req, res) => {
  const session = organization.create(req.body || {});
  access.claim(who(req), session.id);
  if (access.mayUse(who(req), memory.mainSession().id)) memory.setActive(session.id);   // the active pointer is the host's
  res.json({ session });
});

const handleSession = own(async (req, res) => {
  const session = memory.getSession(req.params.id);
  res.json({ session: { ...session, ...organization.view(session) }, messages: memory.messages(req.params.id) });
});

const handleSessionArchive = own(async (req, res) =>
  res.json({ session: organization.archive(req.params.id, req.body?.on !== false) }));
const handleSessionStop = own(async (req, res) =>
  res.json({ stopped: agent.cancel(req.params.id) }));
const handlePlan = own(async (req, res) => {
  const plan = organization.plan(req.params.id, req.body || {}, { user: true });
  // Approve is the go-ahead: the work starts (organization.carryOut).
  const started = req.body?.action === 'approve'
    ? organization.carryOut(req.params.id, plan, require('./turn/client').dashboardClient(req)) : undefined;
  res.json({ plan, ...(started ? { started } : {}) });
});

const handleSessionActivate = own(async (req, res) =>
  res.json({ ok: true, active: access.isHost(who(req)) || !who(req)?.id ? memory.setActive(req.params.id) : req.params.id }));

const handleSessionDelete = own(async (req, res) => {
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
  if (id) access.check(who(req), String(id));
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
const handlePromptSize = wrap(async (req, res) => {
  if (req.query.sessionId) access.check(who(req), String(req.query.sessionId));
  res.json(agent.breakdown({ message: String(req.query.message || ''), sessionId: req.query.sessionId || null }));
});

const handleSettingsRead = wrap(async (_req, res) =>
  res.json({ settings: settings.readable(), sections: settings.SETTABLE }));

// Who decides a proposal (approved 2026-10-07): the hive's settings are for a level holding `propose`; a proposal for one
// screen is also its person's, whatever their level — they may change that screen themselves (/api/screen is `read`).
const proposalPerson = req => req.auth?.user ? { ...req.auth.user, role: req.auth.role } : null;
const mayDecide = (req, p) => {
  const person = proposalPerson(req);
  if (!person?.role || require('../auth/rights').can(person.role, 'propose')) return true;
  if (!p?.screen) return false;
  if (p.screen.id === `person:${person.id}`) return true;   // their own layer, on every device (panel layout)
  const d = require('../api-v1/devices').get(p.screen.id);
  return !!d && d.userId === person.id;
};
const handleProposals = wrap(async (req, res) => {
  const all = settings.list();
  const person = proposalPerson(req);
  if (!person?.role || require('../auth/rights').can(person.role, 'propose')) return res.json(all);
  res.json({ pending: all.pending.filter(p => mayDecide(req, p)), decided: all.decided.filter(p => mayDecide(req, p)) });
});

const handleProposalApply = wrap(async (req, res) => {
  // A level is bound to the settings it may change (auth/levels.js): every path the proposal touches must
  // be within the applier's — or granted to them (setting:<prefix>).
  const p = settings.list().pending.find(x => x.id === req.params.id);
  if (p && !mayDecide(req, p)) return res.status(403).json({ error: 'Only someone whose level holds "propose" decides the hive\'s settings; a proposal for one screen is its person\'s.' });
  const person = req.auth && { ...req.auth.user, role: req.auth.role };
  // A screen's own settings are its person's to change at any level (/api/screen is `read`); whose screen it is decides.
  const outside = p?.screen ? [] : (p?.changes || []).map(c => c.path).filter(path => person?.role && !require('../auth/permits').holds(person, `setting:${path}`));
  if (outside.length) return res.status(403).json({ error: `Your level does not cover ${outside.join(', ')}; someone whose level does can apply it.` });
  res.json({ ok: true, ...settings.apply(req.params.id, { person: req.auth?.user ? person : null }) });
});

const handleProposalReject = wrap(async (req, res) => {
  const p = settings.list().pending.find(x => x.id === req.params.id);
  if (p && !mayDecide(req, p)) return res.status(403).json({ error: 'Only someone whose level holds "propose" decides the hive\'s settings; a proposal for one screen is its person\'s.' });
  res.json({ ok: true, proposal: settings.reject(req.params.id, req.body?.reason) });
});

/* ── Specialist agents and their missions ─────────────── */

const handleAgents = wrap(async (_req, res) => {
  // `toolCount` is what the specialist is really offered — its kits, its named
  // tools and the ones every specialist gets, minus NEVER — the same answer
  // disabledFor gives its turns; a definition made of kits names no tools.
  const all = tools.describe().length;
  const { disabledFor } = require('./turn/prompt');
  const agents = registry.list().map(a => (a.broken ? a
    : { ...a, toolCount: all - disabledFor({ kits: a.kits || [], tools: a.tools || [], level: 'specialist' }, {}).length }));
  res.json({ enabled: registry.enabled(), dir: registry.dir(), agents, never: registry.NEVER });
});

/** What an agent type holds and why: `orchestrator`, `work` or a specialist's id (tool-roster.js). */
const handleAgentTools = wrap(async (req, res) => res.json(require('./tool-roster').roster(req.params.id)));

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

// The person's own missions (a host's, every one); `live=1`: running, or finished and not yet opened (seen.js).
const handleMissions = wrap(async (req, res) => {
  const access = require('./session-access'), person = who(req);
  const rows = missions.list({ state: req.query.state, limit: 200, all: req.query.all === '1' })
    .filter(m => access.mayUse(person, m.sessionId || m.by) && (req.query.live !== '1' || m.state === 'running' || !m.seenAt));
  res.json({ missions: rows.slice(0, Number(req.query.limit) || 50) });
});

/** POST /api/harness/missions/:id/archive - put a finished one away, or bring it back. */
const handleMissionArchive = wrap(async (req, res) =>
  res.json({ ok: true, mission: missions.archive(req.params.id, { on: req.body?.archived !== false }) }));

const handleMission = wrap(async (req, res) => {
  const m = missions.get(req.params.id);
  if (!m || !require('./session-access').mayUse(who(req), m.sessionId || m.by)) return res.status(404).json({ error: `No mission called "${req.params.id}"` });
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
  handleAgents, handleAgentTools, handleAgentsEnable, handleAgentSave, handleAgentDelete, handleMissions, handleMission, handleMissionArchive,
  handleInstalls, handleInstallApply, handleInstallReject,
  handleList, handleSetDefault, handleInstall, handleConfig, handleAddCustom, handleRemoveCustom,
  handleProviders, handleModels, handleToolCheck, handleStatus, handleUsage,
  handleChat, handleSessions, handleSessionNew, handleSession, handleSessionActivate, handleSessionDelete,
  handleMemoryList, handleMemoryWrite, handleMemoryForget, handleMemoryLock, handleMemoryFlag,

  handleEnvironment, handlePromptSize, handleSettingsRead, handleProposals, handleProposalApply, handleProposalReject,
  handleApproval, handleApprovalMode, handleApprovalDecide, handleApprovalForget,
};
