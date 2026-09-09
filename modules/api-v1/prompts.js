'use strict';

/**
 * Prompts: the agent → user → agent interaction cycle.
 *
 *   agent raises prompt (choices typed: option | voice | text | image | dismiss)
 *     → devices receive `prompt.new`
 *     → user selects: option gives an instant pre-supplied outcome;
 *       voice/text/image go `pending` and the outcome arrives later as a
 *       durable `prompt.outcome` event (resolved by the server via the
 *       gateway, or by the agent itself)
 *     → user confirms (runs the outcome's action if any) or goes back
 *
 * Per-device state machine:
 *   open → outcome_ready → confirmed
 *   open → pending → outcome_ready | open(+error)
 *   outcome_ready → open (back)
 *   any → dismissed | closed (confirmed elsewhere, cancelled, expired)
 *
 * Idempotency: `selectionId` (client UUID) keys both select and confirm; a
 * retry returns the original response.
 */
const crypto  = require('crypto');
const store   = require('./store');
const bus     = require('./bus');
const devices = require('./devices');
const profiles = require('./profiles');
const commands = require('./commands');
const motion  = require('./motion');
const media   = require('./media');
const { hasScope } = require('./scopes');
const { ApiError } = require('./errors');
const L = require('./limits');

const CHOICE_TYPES = ['option', 'voice', 'text', 'image', 'dismiss'];
const PRIORITIES   = ['low', 'normal', 'high', 'urgent'];
const TERMINAL     = new Set(['confirmed', 'cancelled', 'expired']);

let _db = null;
const _timers = new Map();
let _resolverHook = null;   // test seam: override server resolver

function db() { if (!_db) _db = store.readJson('prompts', { prompts: {} }); return _db; }
function persist() { store.writeJson('prompts', db()); }

const str = (s, n) => typeof s === 'string' ? s.slice(0, n) : undefined;
const ext = o => o && typeof o === 'object' && JSON.stringify(o).length <= L.EXT_BYTES ? o : undefined;

// ─── Validation ──────────────────────────────────────────────────────────────

function normalizeOutcome(o, allowedCommands) {
  if (!o || typeof o !== 'object') throw new ApiError(400, 'invalid_outcome', 'outcome must be an object');
  const out = {
    summary: str(o.summary, 200),
    detail:  str(o.detail, 1000),
    blocks:  motion.normalizeBlocks(o.blocks),
    confirmLabel: str(o.confirmLabel, 24) || 'Confirm',
    backLabel:    str(o.backLabel, 24) || 'Back',
    ext: ext(o.ext),
  };
  if (!out.summary) throw new ApiError(400, 'invalid_outcome', 'outcome.summary is required');
  if (o.action && typeof o.action === 'object' && o.action.commandId) {
    const id = String(o.action.commandId);
    if (!commands.get(id)) throw new ApiError(400, 'invalid_outcome', `Unknown commandId '${id}'`, { commandId: id });
    if (allowedCommands && !allowedCommands.includes(id)) throw new ApiError(400, 'invalid_outcome', `commandId '${id}' not in prompt.allowedCommands`);
    out.action = { commandId: id, params: commands.validateParams(id, o.action.params || {}) };
  }
  return out;
}

function normalizeChoice(c, allowedCommands) {
  if (!c || typeof c !== 'object' || !CHOICE_TYPES.includes(c.type)) throw new ApiError(400, 'invalid_choice', `choice.type must be one of ${CHOICE_TYPES.join(', ')}`);
  const out = { id: str(c.id, 32) || `c_${crypto.randomBytes(3).toString('hex')}`, type: c.type, label: str(c.label, 40) || c.type, ext: ext(c.ext) };
  if (c.type === 'option') out.outcome = normalizeOutcome(c.outcome, allowedCommands);
  if (c.type === 'voice') { out.maxSec = Math.min(L.AUDIO_SEC, Math.max(1, Number(c.maxSec) || 20)); out.accept = ['audio/ogg', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'text/plain']; }
  if (c.type === 'text')  { out.maxChars = Math.min(2000, Math.max(1, Number(c.maxChars) || 280)); out.placeholder = str(c.placeholder, 60); }
  if (c.type === 'image') { out.accept = ['image/jpeg', 'image/png', 'image/webp']; out.maxBytes = L.MEDIA_BYTES; out.caption = c.caption !== false; }
  return out;
}

function normalizePrompt(body, agentId) {
  if (!body || typeof body !== 'object') throw new ApiError(400, 'invalid_prompt', 'body must be an object');
  const title = str(body.title, 120);
  if (!title) throw new ApiError(400, 'invalid_prompt', 'title is required');
  const allowedCommands = Array.isArray(body.allowedCommands) ? body.allowedCommands.map(String) : null;
  const choices = (Array.isArray(body.choices) ? body.choices : []).slice(0, L.PROMPT_MAX_CHOICES).map(c => normalizeChoice(c, allowedCommands));
  if (!choices.length) throw new ApiError(400, 'invalid_prompt', 'at least one choice is required');
  const ids = new Set(choices.map(c => c.id));
  if (ids.size !== choices.length) throw new ApiError(400, 'invalid_prompt', 'choice ids must be unique');
  const ttlSec = Math.min(7 * 86400, Math.max(30, Number(body.ttlSec) || L.PROMPT_DEFAULT_TTL_SEC));
  const now = Date.now();
  const p = {
    id: str(body.id, 64) || `prm_${crypto.randomBytes(8).toString('hex')}`,
    agentId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlSec * 1000).toISOString(),
    priority: PRIORITIES.includes(body.priority) ? body.priority : 'normal',
    title, body: motion.normalizeBlocks(body.body), choices,
    resolver: body.resolver === 'agent' ? 'agent' : 'server',
    targets: Array.isArray(body.targets) && body.targets.length ? body.targets.map(String).slice(0, 64) : null,
    allowedCommands, ext: ext(body.ext),
    state: 'open', perDevice: {}, selections: {}, confirmations: {}, result: null,
  };
  const size = Buffer.byteLength(JSON.stringify({ ...p, body: p.body.map(b => b.type === 'figure' ? { ...b, svg: undefined } : b) }));
  if (size > L.PROMPT_BYTES) throw new ApiError(413, 'payload_too_large', `Prompt is ${size} bytes (limit ${L.PROMPT_BYTES}, excluding figure SVG)`);
  return p;
}

// ─── Targeting & views ───────────────────────────────────────────────────────

function inQuietHours(profile, now = new Date()) {
  const q = profile?.quietHours;
  if (!q) return false;
  const [fh, fm] = q.from.split(':').map(Number), [th, tm] = q.to.split(':').map(Number);
  const cur = now.getHours() * 60 + now.getMinutes(), from = fh * 60 + fm, to = th * 60 + tm;
  return from <= to ? (cur >= from && cur < to) : (cur >= from || cur < to);
}

/** Devices that should receive this prompt right now. */
function targetDevices(p) {
  return devices.list().filter(d => {
    if (d.revokedAt || d.id === p.agentId) return false;
    if (!hasScope(d.scopes, 'interact')) return false;
    if (p.targets && !p.targets.includes(d.id)) return false;
    const prof = profiles.get(d.id);
    if (prof.prompts && prof.prompts.receive === false) return false;
    if (inQuietHours(prof) && !(p.priority === 'urgent' && prof.quietHours.allowUrgent)) return false;
    return true;
  });
}

function choiceAllowedFor(c, device, profile) {
  const caps = device.caps || {}, pp = profile.prompts || {};
  switch (c.type) {
    case 'voice': return pp.allowVoice !== false && (caps.audio?.mic || caps.input?.voice);
    case 'text':  return pp.allowText !== false && (caps.input?.text || caps.input?.voice || caps.input?.touch);
    case 'image': return pp.allowImage !== false && !!caps.input?.camera;
    default: return true;
  }
}

function perDevice(p, deviceId) {
  if (!p.perDevice[deviceId]) p.perDevice[deviceId] = { state: 'open', selectionId: null, choiceId: null, stage: null, outcome: null, error: null, updatedAt: p.createdAt };
  return p.perDevice[deviceId];
}

/** Device-tailored view of a prompt. `opts.compact` avoids inline SVG (event budget). */
function viewFor(p, device, opts = {}) {
  const profile = profiles.get(device.id);
  const pd = perDevice(p, device.id);
  const choices = p.choices.filter(c => choiceAllowedFor(c, device, profile)).map(c => {
    const { outcome, ...rest } = c;
    return c.type === 'option' ? { ...rest, outcome: tailorOutcome(outcome, device, opts) } : rest;
  });
  return {
    id: p.id, createdAt: p.createdAt, expiresAt: p.expiresAt, priority: p.priority,
    title: p.title, body: motion.tailorBlocks(p.body, device.caps, opts), choices, resolver: p.resolver, ext: p.ext,
    state: p.state === 'open' ? pd.state : (pd.state === 'confirmed' ? 'confirmed' : 'closed'),
    selectionId: pd.selectionId, choiceId: pd.choiceId, stage: pd.stage,
    outcome: pd.outcome ? tailorOutcome(pd.outcome, device, opts) : null, error: pd.error,
    haptic: !!(profile.prompts?.haptic) && (p.priority === 'high' || p.priority === 'urgent'),
  };
}

function tailorOutcome(o, device, opts = {}) {
  if (!o) return null;
  return { ...o, blocks: motion.tailorBlocks(o.blocks, device.caps, opts), actionAllowed: o.action ? hasScope(device.scopes, `command:${o.action.commandId}`) : undefined };
}

/** Publish a prompt-shaped event, falling back to the compact view if the full one exceeds the event budget. */
function publishView(deviceId, device, type, build, opts) {
  try { return bus.publish(deviceId, type, build({}), opts); }
  catch (e) {
    if (e.code !== 'event_too_large') throw e;
    return bus.publish(deviceId, type, build({ compact: true }), opts);
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function get(id) { return db().prompts[id] || null; }

function list(filter = {}) {
  return Object.values(db().prompts).filter(p => (!filter.agentId || p.agentId === filter.agentId) && (!filter.state || p.state === filter.state));
}

/** Open prompts visible to a device. */
function openFor(device) {
  return Object.values(db().prompts).filter(p => p.state === 'open' && targetDevices(p).some(d => d.id === device.id))
    .filter(p => !['dismissed', 'closed'].includes(perDevice(p, device.id).state))
    .map(p => viewFor(p, device));
}

function scheduleExpiry(p) {
  const ms = Date.parse(p.expiresAt) - Date.now();
  if (_timers.has(p.id)) clearTimeout(_timers.get(p.id));
  const t = setTimeout(() => expire(p.id), Math.max(0, ms));
  if (t.unref) t.unref();
  _timers.set(p.id, t);
}

function create(body, agent) {
  if (body && body.id && db().prompts[body.id]) return { prompt: db().prompts[body.id], created: false };
  const p = normalizePrompt(body, agent.id);
  db().prompts[p.id] = p;
  persist();
  scheduleExpiry(p);
  const delivered = [];
  for (const d of targetDevices(p)) {
    const env = publishView(d.id, d, 'prompt.new', o => ({ prompt: viewFor(p, d, o) }), { priority: p.priority === 'urgent' ? 'urgent' : 'high', ttlSec: Math.ceil((Date.parse(p.expiresAt) - Date.now()) / 1000) });
    delivered.push({ deviceId: d.id, seq: env.seq });
  }
  p.delivered = delivered;
  persist();
  return { prompt: p, created: true };
}

function closeDevices(p, reason, except) {
  for (const d of targetDevices(p)) {
    if (d.id === except) continue;
    const pd = perDevice(p, d.id);
    if (['confirmed', 'dismissed'].includes(pd.state)) continue;
    pd.state = 'closed'; pd.updatedAt = new Date().toISOString();
    bus.publish(d.id, 'prompt.closed', { promptId: p.id, reason });
  }
}

function expire(id) {
  const p = get(id);
  if (!p || p.state !== 'open') return;
  p.state = 'expired';
  closeDevices(p, 'expired');
  bus.publish(p.agentId, 'prompt.expired', { promptId: p.id });
  persist();
}

function cancel(id, agent) {
  const p = get(id);
  if (!p) throw new ApiError(404, 'not_found', 'Unknown prompt');
  if (p.agentId !== agent.id && !hasScope(agent.scopes, '*')) throw new ApiError(403, 'forbidden', 'Not the owner of this prompt');
  if (p.state === 'open') { p.state = 'cancelled'; closeDevices(p, 'cancelled'); persist(); }
  return p;
}

// ─── Select ──────────────────────────────────────────────────────────────────

function assertVisible(p, device) {
  if (!targetDevices(p).some(d => d.id === device.id) && !perDevice(p, device.id).selectionId) throw new ApiError(404, 'not_found', 'Prompt not addressed to this device');
}

/**
 * @param {object} input { selectionId, choiceId, payload: { kind, text?, transcript?, caption?, ext? } }
 * @param {object} file  optional uploaded file { buffer, mimetype, originalname }
 */
async function select(id, device, input, file) {
  const p = get(id);
  if (!p) throw new ApiError(404, 'not_found', 'Unknown prompt');
  assertVisible(p, device);
  const selectionId = str(input?.selectionId, 64);
  if (!selectionId) throw new ApiError(400, 'invalid_selection', 'selectionId (client UUID) is required');

  const prior = p.selections[selectionId];
  if (prior) {
    if (prior.deviceId !== device.id) throw new ApiError(409, 'selection_conflict', 'selectionId already used by another device');
    return { status: prior.response.status, body: { ...prior.response.body, replay: true } };
  }
  if (p.state !== 'open') throw new ApiError(409, 'prompt_closed', `Prompt is ${p.state}`, { state: p.state });
  const pd = perDevice(p, device.id);
  if (pd.state !== 'open') throw new ApiError(409, 'invalid_state', `Device state is ${pd.state}; use back first`, { state: pd.state, selectionId: pd.selectionId });

  const choice = p.choices.find(c => c.id === input.choiceId);
  if (!choice) throw new ApiError(400, 'invalid_selection', 'Unknown choiceId', { choices: p.choices.map(c => c.id) });
  const profile = profiles.get(device.id);
  if (!choiceAllowedFor(choice, device, profile)) throw new ApiError(403, 'choice_not_available', `Choice type '${choice.type}' is not available to this device`);
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : { kind: choice.type };
  const kind = payload.kind || choice.type;
  if (kind !== choice.type) throw new ApiError(400, 'invalid_selection', `payload.kind '${kind}' does not match choice type '${choice.type}'`);

  const now = new Date().toISOString();
  pd.selectionId = selectionId; pd.choiceId = choice.id; pd.error = null; pd.updatedAt = now;
  let response;

  if (choice.type === 'option') {
    pd.state = 'outcome_ready'; pd.outcome = choice.outcome; pd.stage = null;
    response = { status: 200, body: { status: 'outcome_ready', promptId: p.id, selectionId, outcome: tailorOutcome(choice.outcome, device) } };
  } else if (choice.type === 'dismiss') {
    pd.state = 'dismissed'; pd.stage = null;
    bus.publish(p.agentId, 'prompt.dismissed', { promptId: p.id, deviceId: device.id, selectionId });
    response = { status: 200, body: { status: 'dismissed', promptId: p.id, selectionId } };
  } else {
    // Free-form: text / voice / image → pending, resolved asynchronously.
    const free = await captureFreeInput(choice, payload, file, device);
    pd.state = 'pending'; pd.stage = free.needsTranscription ? 'transcribing' : 'thinking'; pd.outcome = null; pd.input = free.summary;
    response = { status: 202, body: { status: 'pending', promptId: p.id, selectionId, stage: pd.stage, expectedWithinSec: free.needsTranscription ? 15 : 8, pollUrl: `/api/v1/prompts/${p.id}` } };
    setImmediate(() => resolvePending(p.id, device.id, selectionId, free).catch(() => {}));
  }
  p.selections[selectionId] = { deviceId: device.id, choiceId: choice.id, createdAt: now, response };
  persist();
  return response;
}

/** Validate and store the free-form input; returns what the resolver needs. */
async function captureFreeInput(choice, payload, file, device) {
  const summary = { kind: choice.type, ext: ext(payload.ext) };
  if (choice.type === 'text') {
    const text = str(payload.text, choice.maxChars);
    if (!text || !text.trim()) throw new ApiError(400, 'invalid_selection', 'payload.text is required for a text choice');
    summary.text = text.trim();
    return { summary, needsTranscription: false, input: { kind: 'text', text: summary.text } };
  }
  if (choice.type === 'voice') {
    const transcript = str(payload.transcript, 2000);
    if (transcript && transcript.trim()) {
      summary.transcript = transcript.trim(); summary.transcriptSource = 'device';
      if (file) summary.mediaId = media.save(file.buffer, file.mimetype, device.id, { durationMs: payload.durationMs, source: 'voice' }).id;
      return { summary, needsTranscription: false, input: { kind: 'voice', transcript: summary.transcript } };
    }
    if (!file) throw new ApiError(400, 'invalid_selection', 'voice choice needs an audio file part or payload.transcript');
    const m = media.save(file.buffer, file.mimetype, device.id, { durationMs: payload.durationMs, source: 'voice' });
    summary.mediaId = m.id;
    return { summary, needsTranscription: true, input: { kind: 'voice', mediaId: m.id, mime: m.mime } };
  }
  if (choice.type === 'image') {
    let mediaId = str(payload.mediaId, 64);
    if (file) mediaId = media.save(file.buffer, file.mimetype, device.id, { w: payload.w, h: payload.h, source: 'camera' }).id;
    if (!mediaId || !media.get(mediaId)) throw new ApiError(400, 'invalid_selection', 'image choice needs an image file part or a valid payload.mediaId');
    summary.mediaId = mediaId; summary.caption = str(payload.caption, 280);
    return { summary, needsTranscription: false, input: { kind: 'image', mediaId, caption: summary.caption } };
  }
  throw new ApiError(400, 'invalid_selection', 'Unsupported choice type');
}

/** Background resolution of a pending selection. */
async function resolvePending(promptId, deviceId, selectionId, free) {
  const p = get(promptId);
  const device = devices.get(deviceId);
  if (!p || !device) return;
  const pd = perDevice(p, deviceId);
  const stillCurrent = () => pd.selectionId === selectionId && pd.state === 'pending' && p.state === 'open';
  const progress = stage => { pd.stage = stage; try { bus.publish(deviceId, 'prompt.progress', { promptId, selectionId, stage }); } catch {} };

  try {
    const input = { ...free.input };
    if (free.needsTranscription) {
      progress('transcribing');
      const { transcribeAudio } = require('../chat');
      const buf = media.readBuffer(input.mediaId);
      input.transcript = await transcribeAudio(buf, input.mime, `voice.${input.mime.split('/')[1]}`);
      free.summary.transcript = input.transcript; free.summary.transcriptSource = 'server';
      if (!stillCurrent()) return;
    }
    progress('thinking');
    const selectedPayload = { kind: input.kind, text: input.text, transcript: input.transcript, caption: input.caption,
                              mediaId: free.summary.mediaId, mediaUrl: free.summary.mediaId ? `/api/v1/media/${free.summary.mediaId}` : undefined, ext: free.summary.ext };
    bus.publish(p.agentId, 'prompt.selected', { promptId, selectionId, deviceId, choiceId: pd.choiceId, payload: selectedPayload, resolver: p.resolver });
    persist();

    if (p.resolver === 'agent') {
      // The agent posts the outcome via POST /agent/prompts/:id/outcome. Time out if it never does.
      const t = setTimeout(() => {
        const cur = get(promptId); if (!cur) return;
        const cpd = perDevice(cur, deviceId);
        if (cpd.selectionId === selectionId && cpd.state === 'pending') failPending(cur, deviceId, selectionId, 'resolver_timeout', 'The agent did not answer in time');
      }, L.PENDING_TIMEOUT_SEC * 1000);
      if (t.unref) t.unref();
      return;
    }
    const resolver = _resolverHook || require('./agent-bridge').resolve;
    if (input.kind === 'image') { const b = media.get(input.mediaId); input.imageBuffer = media.readBuffer(input.mediaId); input.imageMime = b?.mime; }
    const candidate = await resolver(p, input);
    if (!stillCurrent()) return;
    deliverOutcome(p, deviceId, selectionId, candidate, 'server');
  } catch (e) {
    if (stillCurrent()) failPending(p, deviceId, selectionId, e.code || 'resolver_failed', e.message);
  }
}

function failPending(p, deviceId, selectionId, code, message) {
  const pd = perDevice(p, deviceId);
  pd.state = 'open'; pd.stage = null; pd.error = { code, message }; pd.updatedAt = new Date().toISOString();
  bus.publish(deviceId, 'prompt.outcome', { promptId: p.id, selectionId, status: 'failed', error: { code, message } });
  persist();
}

/** Attach a resolved outcome to a pending selection and push it. */
function deliverOutcome(p, deviceId, selectionId, candidate, source) {
  const device = devices.get(deviceId);
  const pd = perDevice(p, deviceId);
  if (pd.selectionId !== selectionId || pd.state !== 'pending') throw new ApiError(409, 'stale_selection', 'Selection is no longer pending', { state: pd.state, selectionId: pd.selectionId });
  const outcome = normalizeOutcome(candidate, p.allowedCommands);
  pd.state = 'outcome_ready'; pd.stage = null; pd.outcome = outcome; pd.outcomeSource = source; pd.updatedAt = new Date().toISOString();
  publishView(deviceId, device, 'prompt.outcome', o => ({ promptId: p.id, selectionId, status: 'outcome_ready', outcome: tailorOutcome(outcome, device, o) }));
  persist();
  return outcome;
}

/** Agent-supplied outcome for a pending free-form selection. */
function agentOutcome(id, agent, body) {
  const p = get(id);
  if (!p) throw new ApiError(404, 'not_found', 'Unknown prompt');
  if (p.agentId !== agent.id && !hasScope(agent.scopes, '*')) throw new ApiError(403, 'forbidden', 'Not the owner of this prompt');
  const selectionId = str(body?.selectionId, 64);
  const sel = p.selections[selectionId];
  if (!sel) throw new ApiError(404, 'not_found', 'Unknown selectionId');
  return deliverOutcome(p, sel.deviceId, selectionId, body.outcome, 'agent');
}

// ─── Confirm / back ──────────────────────────────────────────────────────────

async function confirm(id, device, input) {
  const p = get(id);
  if (!p) throw new ApiError(404, 'not_found', 'Unknown prompt');
  const selectionId = str(input?.selectionId, 64);
  const decision = input?.decision === 'back' ? 'back' : input?.decision === 'confirm' ? 'confirm' : null;
  if (!selectionId || !decision) throw new ApiError(400, 'invalid_confirmation', 'selectionId and decision (confirm|back) are required');

  const prev = p.confirmations[selectionId];
  if (prev && prev.decision === decision) return { status: 200, body: { ...prev.body, replay: true } };

  const pd = perDevice(p, device.id);
  if (pd.selectionId !== selectionId) throw new ApiError(409, 'stale_selection', 'selectionId is not the current selection for this device', { state: pd.state, selectionId: pd.selectionId });

  if (decision === 'back') {
    if (!['outcome_ready', 'pending'].includes(pd.state)) throw new ApiError(409, 'invalid_state', `Cannot go back from ${pd.state}`, { state: pd.state });
    pd.state = 'open'; pd.selectionId = null; pd.choiceId = null; pd.outcome = null; pd.stage = null; pd.updatedAt = new Date().toISOString();
    const body = { status: 'open', promptId: p.id, selectionId };
    p.confirmations[selectionId] = { decision, body };
    persist();
    return { status: 200, body };
  }

  if (p.state !== 'open') throw new ApiError(409, 'prompt_closed', `Prompt is ${p.state}`, { state: p.state });
  if (pd.state !== 'outcome_ready') throw new ApiError(409, 'invalid_state', `Nothing to confirm: device state is ${pd.state}`, { state: pd.state });

  let execution = null;
  const action = pd.outcome?.action;
  if (action) {
    if (!hasScope(device.scopes, `command:${action.commandId}`)) throw new ApiError(403, 'scope_required', `Confirming this outcome requires command:${action.commandId}`, { required: [`command:${action.commandId}`] });
    const r = await commands.execute(action.commandId, action.params, device.id);
    execution = r.kind === 'job' ? { jobId: r.job.id, status: 'running' } : { status: 'done', result: r.result };
  }
  pd.state = 'confirmed'; pd.updatedAt = new Date().toISOString();
  p.state = 'confirmed';
  p.result = { deviceId: device.id, selectionId, choiceId: pd.choiceId, outcome: pd.outcome, input: pd.input || null, execution, at: pd.updatedAt };
  const body = { status: 'confirmed', promptId: p.id, selectionId, execution };
  p.confirmations[selectionId] = { decision, body };
  closeDevices(p, 'confirmed_elsewhere', device.id);
  bus.publish(p.agentId, 'prompt.confirmed', { promptId: p.id, deviceId: device.id, selectionId, choiceId: pd.choiceId, input: pd.input || null, outcome: pd.outcome, execution });
  persist();
  return { status: 200, body };
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

function prune() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let changed = false;
  for (const [id, p] of Object.entries(db().prompts)) {
    if (TERMINAL.has(p.state) && Date.parse(p.expiresAt) < cutoff) { delete db().prompts[id]; changed = true; }
  }
  if (changed) persist();
}

function restoreTimers() { for (const p of Object.values(db().prompts)) if (p.state === 'open') scheduleExpiry(p); }

function _reset() { for (const t of _timers.values()) clearTimeout(t); _timers.clear(); _db = null; }
function _setResolver(fn) { _resolverHook = fn; }

module.exports = { CHOICE_TYPES, PRIORITIES, get, list, openFor, viewFor, create, cancel, select, confirm, agentOutcome, expire, prune, restoreTimers, targetDevices, _reset, _setResolver };
