'use strict';

/**
 * /api/v1 — device-agnostic client API. Mounted by server.js; nothing here
 * touches the legacy /api/* routes.
 */
const express = require('express');
const multer  = require('multer');

const L          = require('./limits');
const { ApiError, sendError, errorMiddleware, wrap } = require('./errors');
const { authenticate, requireScope, can, resolveDeviceId } = require('./auth');
const { hasScope, normalizeAll, PRESETS, FAMILIES } = require('./scopes');
const devices    = require('./devices');
const bus        = require('./bus');
const sampler    = require('./sampler');
const surfaces   = require('./surfaces');
const commands   = require('./commands');
const jobs       = require('./jobs');
const profiles   = require('./profiles');
const prompts    = require('./prompts');
const media      = require('./media');
const artifacts  = require('./artifacts');
const sensors    = require('./sensors');
const motion     = require('./motion');
const render     = require('./render');
const capabilities = require('./capabilities');
const live       = require('./live');
const harness    = require('./harness');

const router = express.Router();
router.use(express.json({ limit: L.JSON_BODY_LIMIT }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: L.MEDIA_BYTES } });
const anyFile = upload.fields([{ name: 'file', maxCount: 1 }, { name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]);
const firstFile = req => req.files ? (req.files.file || req.files.audio || req.files.image || [])[0] : req.file;

router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Doca-Protocol', L.PROTOCOL_VERSION); next(); });

live.wire();
prompts.restoreTimers();
setInterval(() => { media.purgeExpired(); prompts.prune(); }, 15 * 60 * 1000).unref();

// ─── Unauthenticated ─────────────────────────────────────────────────────────

router.get('/', (_req, res) => res.json({
  name: 'doca', protocol: { version: L.PROTOCOL_VERSION, minClient: L.PROTOCOL_MIN_CLIENT },
  auth: 'Authorization: Bearer doca_<device>.<secret>', pairUrl: '/api/v1/devices/pair/complete', capabilitiesUrl: '/api/v1/capabilities',
  openapiUrl: '/api/v1/openapi.json', docs: 'PROTOCOL.md', guides: 'docs/api/README.md',
}));

// Machine-readable description of this API; public so generators and API tools can fetch it before pairing.
router.get('/openapi.json', (_req, res) => { res.setHeader('Cache-Control', 'public, max-age=300'); res.json(require('./openapi').document()); });

router.post('/devices/pair/complete', wrap(async (req, res) => {
  const { code, caps, name } = req.body || {};
  if (!code) throw new ApiError(400, 'invalid_pairing', 'code is required');
  const r = devices.completePairing(code, caps, name);
  if (!r) throw new ApiError(400, 'invalid_pairing', 'Pairing code is unknown or expired');
  res.status(201).json({ token: r.token, device: r.device, capabilitiesUrl: '/api/v1/capabilities', protocol: L.PROTOCOL_VERSION });
}));

// ─── Everything below requires a token ──────────────────────────────────────

router.use((req, res, next) => authenticate({ allowQuery: req.path === '/events' })(req, res, next));
router.use((req, _res, next) => { devices.touchPersist(); next(); });

router.get('/capabilities', wrap(async (req, res) => res.json(await capabilities.build(req.device))));

// ─── Devices ────────────────────────────────────────────────────────────────

const selfOr = (...scopes) => (req, res, next) => {
  const id = resolveDeviceId(req);
  if (id === req.device.id || scopes.some(s => can(req, s))) return next();
  return sendError(res, 403, 'scope_required', `Requires ${scopes.join(' or ')} for other devices`, { required: scopes });
};

router.get('/devices', requireScope('devices:admin', 'agent'), (req, res) => {
  res.json({ devices: devices.list().map(d => ({ ...d, online: bus.isOnline(d.id), pending: bus.pendingCount(d.id) })), presets: PRESETS, scopeFamilies: FAMILIES });
});

router.post('/devices', requireScope('devices:admin'), wrap(async (req, res) => {
  const { name, scopes, preset, caps, expiresAt, kind } = req.body || {};
  const sc = scopes || (preset && PRESETS[preset]);
  if (!sc) throw new ApiError(400, 'invalid_device', 'scopes[] or preset is required', { presets: Object.keys(PRESETS) });
  const r = devices.create({ name, scopes: sc, caps, expiresAt, kind });
  res.status(201).json(r);
}));

router.post('/devices/pair/start', requireScope('devices:admin'), wrap(async (req, res) => {
  const { name, scopes, preset, expiresAt, kind } = req.body || {};
  const sc = scopes || PRESETS[preset || 'watch'];
  if (!sc) throw new ApiError(400, 'invalid_pairing', 'scopes[] or a known preset is required', { presets: Object.keys(PRESETS) });
  const p = devices.startPairing({ name: name || 'New device', scopes: sc, expiresAt, kind, createdBy: req.device.id });
  res.status(201).json({ ...p, completeUrl: '/api/v1/devices/pair/complete', qr: `doca://pair?code=${p.code.replace('-', '')}&host=${req.headers.host || ''}` });
}));

router.get('/devices/:id', selfOr('devices:admin', 'agent'), (req, res) => {
  const id = resolveDeviceId(req);
  const d = devices.get(id);
  if (!d) return sendError(res, 404, 'not_found', 'Unknown device');
  res.json({ device: devices.publicView(d), online: bus.isOnline(id), pending: bus.pendingCount(id) });
});

router.patch('/devices/:id', selfOr('devices:admin'), wrap(async (req, res) => {
  const id = resolveDeviceId(req);
  const body = req.body || {};
  const patch = id === req.device.id && !can(req, 'devices:admin') ? { caps: body.caps, name: body.name } : body;
  const d = devices.update(id, patch);
  if (!d) throw new ApiError(404, 'not_found', 'Unknown device');
  res.json({ device: d });
}));

router.post('/devices/:id/rotate', selfOr('devices:admin'), wrap(async (req, res) => {
  const r = devices.rotate(resolveDeviceId(req));
  if (!r) throw new ApiError(404, 'not_found', 'Unknown device');
  res.json(r);
}));

router.delete('/devices/:id', requireScope('devices:admin'), wrap(async (req, res) => {
  const id = req.params.id;
  if (id === req.device.id) throw new ApiError(400, 'invalid_request', 'A device cannot revoke itself; use another admin device');
  if (!devices.get(id)) throw new ApiError(404, 'not_found', 'Unknown device');
  try { bus.publish(id, 'revoked', { reason: 'revoked_by_admin', by: req.device.id }); } catch {}
  devices.revoke(id);
  bus.dropDevice(id, 'revoked');
  profiles.remove(id);
  res.json({ ok: true, deviceId: id, revokedAt: new Date().toISOString() });
}));

// ─── Profiles ───────────────────────────────────────────────────────────────

router.get('/devices/:id/profile', selfOr('profile:*', 'agent'), (req, res) => {
  const id = resolveDeviceId(req);
  const target = devices.get(id);
  if (!target) return sendError(res, 404, 'not_found', 'Unknown device');
  const prof = profiles.effective(profiles.get(id), target.scopes);
  res.setHeader('ETag', prof.etag);
  if (req.headers['if-none-match'] === prof.etag) return res.status(304).end();
  res.json({ profile: prof });
});

router.put('/devices/:id/profile', wrap(async (req, res) => {
  const id = resolveDeviceId(req);
  const target = devices.get(id);
  if (!target) throw new ApiError(404, 'not_found', 'Unknown device');
  const ok = id === req.device.id ? (can(req, 'profile:self') || can(req, 'profile:*')) : can(req, 'profile:*');
  if (!ok) throw new ApiError(403, 'scope_required', 'Requires profile:self (own) or profile:* (others)', { required: ['profile:self', 'profile:*'] });
  const current = profiles.get(id);
  const ifMatch = req.headers['if-match'];
  if (ifMatch && ifMatch !== '*' && ifMatch !== profiles.etagOf(current)) throw new ApiError(412, 'etag_mismatch', 'Profile changed since you read it', { currentEtag: profiles.etagOf(current), currentVersion: current.version });
  let stored;
  try { stored = profiles.put(id, req.body, req.device.id); }
  catch (e) { throw new ApiError(400, e.code || 'invalid_profile', e.message); }
  const eff = profiles.effective(stored, target.scopes);
  bus.publish(id, 'profile.changed', { version: stored.version, etag: eff.etag, updatedBy: req.device.id, url: '/api/v1/devices/me/profile' });
  res.setHeader('ETag', eff.etag);
  res.json({ profile: eff });
}));

// ─── Variables ──────────────────────────────────────────────────────────────

router.get('/devices/:id/vars', (req, res) => {
  const id = resolveDeviceId(req);
  if (id !== req.device.id && !can(req, 'vars:*') && !can(req, 'agent')) return sendError(res, 403, 'scope_required', 'Requires vars:*', { required: ['vars:*'] });
  const d = devices.get(id);
  if (!d) return sendError(res, 404, 'not_found', 'Unknown device');
  res.json({ deviceId: id, vars: d.vars || {}, version: d.varsVersion || 0, updatedAt: d.varsUpdatedAt || null });
});

router.patch('/devices/:id/vars', wrap(async (req, res) => {
  const id = resolveDeviceId(req);
  const ok = id === req.device.id ? (can(req, 'vars:self') || can(req, 'vars:*')) : can(req, 'vars:*');
  if (!ok) throw new ApiError(403, 'scope_required', 'Requires vars:self (own) or vars:* (others)', { required: ['vars:self', 'vars:*'] });
  const r = devices.patchVars(id, req.body && typeof req.body === 'object' ? req.body : {});
  if (!r) throw new ApiError(404, 'not_found', 'Unknown device');
  if (r.error) throw new ApiError(413, r.error, `Variables document exceeds ${L.VARS_BYTES} bytes`);
  // Agents learn about variable changes; the device itself does not need an echo.
  for (const d of devices.list()) if (d.id !== id && hasScope(d.scopes, 'agent')) { try { bus.publish(d.id, 'device.vars', { deviceId: id, ...r, changed: Object.keys(req.body || {}) }); } catch {} }
  res.json({ deviceId: id, ...r });
}));

// ─── The MCP server this device hosts ───────────────────────────────────────

/**
 * A client that hosts its own MCP server can see and correct *its own* entry,
 * and nothing else. It cannot list other servers, cannot create one, and cannot
 * turn a definition into a command — `mcpServers` holds something that gets
 * spawned, so a client able to write one freely would be a way to run code on
 * this host. Managing the registry stays where it is: the dashboard.
 *
 * What this does buy is the case that actually breaks. A client whose URL
 * carries a secret regenerates it on restart, and until now that left a dead
 * row nobody could fix but a human with a clipboard.
 */
const mcpSelf = require('../mcp/registry');

router.get('/mcp/self', requireScope('mcp:self'), (req, res) => {
  const spec = mcpSelf.forDevice(req.device.id);
  if (!spec) return sendError(res, 404, 'not_found', 'No MCP server on this host is pointed at this device. Add one from the dashboard with "Runs on → a paired client".');
  const s = mcpSelf.status(spec);
  res.json({ server: { id: s.id, label: s.label, transport: s.transport, url: s.url, headers: s.headers, autostart: s.autostart, state: s.state, error: s.error, toolCount: s.toolCount } });
});

/**
 * Offer the server this device hosts, instead of a human copying a URL between
 * two machines. This writes nothing into the registry: it queues a card in the
 * dashboard, and a click is what creates the definition.
 */
router.post('/mcp/offer', requireScope('mcp:self'), wrap(async (req, res) => {
  try {
    res.status(202).json({ offer: require('../mcp/offers').offer(req.device.id, req.device.name, req.body || {}) });
  } catch (e) {
    throw new ApiError(e.status || 400, e.status === 429 ? 'rate_limited' : 'invalid_request', e.message);
  }
}));

router.patch('/mcp/self', requireScope('mcp:self'), wrap(async (req, res) => {
  let spec;
  try { spec = mcpSelf.updateFromDevice(req.device.id, req.body); }
  catch (e) { throw new ApiError(e.status || 400, 'invalid_request', e.message); }
  if (!spec) throw new ApiError(404, 'not_found', 'No MCP server on this host is pointed at this device');
  const s = mcpSelf.status(spec);
  res.json({ server: { id: s.id, label: s.label, transport: s.transport, url: s.url, headers: s.headers, state: s.state } });
}));

// ─── Sensors (device side) ──────────────────────────────────────────────────

router.get('/devices/:id/sensors', (req, res) => {
  const id = resolveDeviceId(req);
  if (id !== req.device.id && !can(req, 'sensors:*') && !can(req, 'agent')) return sendError(res, 403, 'scope_required', 'Requires sensors:*', { required: ['sensors:*'] });
  const d = devices.get(id);
  if (!d) return sendError(res, 404, 'not_found', 'Unknown device');
  res.json({ deviceId: id, declared: d.caps?.sensors || [], latest: sensors.latest(id) });
});

router.post('/sensors/samples', requireScope('sensors:report', 'sensors:*'), wrap(async (req, res) => {
  const r = sensors.ingest(req.device, profiles.get(req.device.id), req.body);
  if (r.error) throw new ApiError(404, r.error, 'requestId is unknown, expired or belongs to another device');
  res.json(r);
}));

// ─── Surfaces / snapshots ───────────────────────────────────────────────────

const readableIds = async (req, requested) => {
  const all = await surfaces.availableIds();
  const ids = requested ? requested.filter(id => all.includes(id)) : all;
  return ids.filter(id => hasScope(req.device.scopes, `read:${id}`));
};
const snapshotExtra = req => ({ openPrompts: hasScope(req.device.scopes, 'interact') ? prompts.openFor(req.device).length : 0, llamacppInstances: (() => { try { return require('../models-llamacpp').loadInstances(); } catch { return []; } })() });

router.get('/surfaces', wrap(async (req, res) => {
  const sample = await sampler.latest(30);
  const defs = surfaces.definitions(sample.status);
  const ids = await readableIds(req);
  res.json({ surfaces: ids.map(id => surfaces.describe(defs[id])), observedAt: sample.observedAt });
}));

router.get('/snapshot', wrap(async (req, res) => {
  const requested = typeof req.query.surfaces === 'string' ? req.query.surfaces.split(',').map(s => s.trim()).filter(Boolean) : null;
  const ids = await readableIds(req, requested);
  const r = await surfaces.snapshot(ids, { spark: req.query.spark === '1' || req.query.spark === 'true', sparkPoints: parseInt(req.query.sparkPoints, 10) || undefined, extra: snapshotExtra(req) });
  const body = JSON.stringify(r);
  if (Buffer.byteLength(body) > L.SNAPSHOT_BYTES * Math.max(1, ids.length)) return sendError(res, 413, 'payload_too_large', 'Snapshot exceeds budget; request fewer surfaces or disable spark');
  const etag = `"${require('crypto').createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.type('json').send(body);
}));

router.get('/surfaces/:id', wrap(async (req, res) => {
  const id = req.params.id;
  if (!hasScope(req.device.scopes, `read:${id}`)) throw new ApiError(403, 'scope_required', `Requires read:${id}`, { required: [`read:${id}`] });
  const r = await surfaces.snapshot([id], { spark: req.query.spark === '1' || req.query.spark === 'true', extra: snapshotExtra(req) });
  if (!r.surfaces.length) throw new ApiError(404, 'not_found', 'Unknown surface (it may not exist on this host)');
  res.json({ surface: r.surfaces[0], observedAt: r.observedAt, stale: r.stale });
}));

// ─── Commands / jobs ────────────────────────────────────────────────────────

const _idem = new Map();
function idemKey(req) { return req.body?.idempotencyKey ? `${req.device.id}:${req.body.idempotencyKey}` : null; }

router.get('/commands', (req, res) => res.json({ commands: commands.ids().filter(id => hasScope(req.device.scopes, `command:${id}`)).map(commands.describe) }));

router.post('/commands/:id', wrap(async (req, res) => {
  const id = req.params.id;
  if (!commands.get(id)) throw new ApiError(404, 'unknown_command', `No command '${id}'`);
  if (!hasScope(req.device.scopes, `command:${id}`)) throw new ApiError(403, 'scope_required', `Requires command:${id}`, { required: [`command:${id}`] });
  const key = idemKey(req);
  if (key && _idem.has(key)) { const r = _idem.get(key); return res.status(r.status).json({ ...r.body, replay: true }); }
  const r = await commands.execute(id, req.body?.params, req.device.id);
  const out = r.kind === 'job' ? { status: 202, body: { status: 'running', jobId: r.job.id, commandId: id, jobUrl: `/api/v1/jobs/${r.job.id}` } } : { status: 200, body: { status: 'done', commandId: id, result: r.result } };
  if (key) { _idem.set(key, out); if (_idem.size > 2000) _idem.delete(_idem.keys().next().value); }
  res.status(out.status).json(out.body);
}));

router.get('/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || (j.deviceId !== req.device.id && !can(req, 'agent') && !can(req, 'devices:admin'))) return sendError(res, 404, 'not_found', 'Unknown job');
  res.json({ job: jobs.publicView(j) });
});

// ─── Events (push) ──────────────────────────────────────────────────────────

router.get('/events', (req, res) => {
  const since = parseInt(req.query.since ?? req.headers['last-event-id'] ?? '0', 10) || 0;
  const wantsStream = /text\/event-stream/.test(req.headers.accept || '') || req.query.stream === '1';
  if (!wantsStream) {
    const r = bus.drain(req.device.id, since);
    return res.json({ ...r, retryAfterSec: profiles.get(req.device.id).refreshSec || 10 });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`retry: 3000\n\n`);
  const send = env => res.write(`id: ${env.seq}\nevent: ${env.type}\ndata: ${JSON.stringify(env)}\n\n`);
  const sub = { send, close: (reason) => { try { res.write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`); } catch {} res.end(); } };
  const { replay, cursor, resync, unsubscribe } = bus.subscribe(req.device.id, since, sub);
  res.write(`event: hello\ndata: ${JSON.stringify({ deviceId: req.device.id, cursor, since, replay: replay.length, resync, heartbeatSec: L.HEARTBEAT_SEC, protocol: L.PROTOCOL_VERSION })}\n\n`);
  if (resync) bus.publish(req.device.id, 'resync', { reason: 'cursor_before_retained_history', cursor });
  for (const env of replay) send(env);
  const hb = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, L.HEARTBEAT_SEC * 1000);
  live.onConnect(req.device);
  req.on('close', () => { clearInterval(hb); unsubscribe(); });
});

router.post('/events/ack', (req, res) => {
  const seq = parseInt(req.body?.seq, 10);
  if (!Number.isFinite(seq)) return sendError(res, 400, 'invalid_request', 'seq is required');
  res.json({ acked: bus.ackUpTo(req.device.id, seq), pending: bus.pendingCount(req.device.id), cursor: bus.cursor(req.device.id) });
});

// ─── Prompts (device side) ──────────────────────────────────────────────────

router.get('/prompts', requireScope('interact'), (req, res) => res.json({ prompts: prompts.openFor(req.device) }));

router.get('/prompts/:id', requireScope('interact'), (req, res) => {
  const p = prompts.get(req.params.id);
  if (!p) return sendError(res, 404, 'not_found', 'Unknown prompt');
  res.json({ prompt: prompts.viewFor(p, req.device) });
});

router.post('/prompts/:id/select', requireScope('interact'), anyFile, wrap(async (req, res) => {
  let input = req.body || {};
  if (typeof input.payload === 'string') { try { input = { ...input, payload: JSON.parse(input.payload) }; } catch { throw new ApiError(400, 'bad_json', 'payload field must be JSON'); } }
  const r = await prompts.select(req.params.id, req.device, input, firstFile(req));
  res.status(r.status).json(r.body);
}));

router.post('/prompts/:id/confirm', requireScope('interact'), wrap(async (req, res) => {
  const r = await prompts.confirm(req.params.id, req.device, req.body);
  res.status(r.status).json(r.body);
}));

// ─── Messages (device → agent, free-form) ───────────────────────────────────

router.post('/messages', requireScope('interact'), wrap(async (req, res) => {
  const { type, payload, to, ext } = req.body || {};
  const body = { from: req.device.id, type: typeof type === 'string' ? type.slice(0, 64) : 'message', payload: payload ?? null, ext };
  if (Buffer.byteLength(JSON.stringify(body)) > L.EVENT_BYTES - 512) throw new ApiError(413, 'payload_too_large', 'Message too large');
  const targets = devices.list().filter(d => !d.revokedAt && d.id !== req.device.id && (to ? d.id === to : hasScope(d.scopes, 'agent')));
  if (!targets.length) throw new ApiError(404, 'no_recipient', to ? 'Unknown recipient' : 'No agent device is registered');
  const delivered = targets.map(d => ({ deviceId: d.id, seq: bus.publish(d.id, 'device.message', body).seq }));
  res.status(202).json({ delivered });
}));

// ─── Media ──────────────────────────────────────────────────────────────────

router.post('/media', requireScope('media:upload', 'media:*', 'agent'), anyFile, wrap(async (req, res) => {
  const f = firstFile(req);
  if (!f) throw new ApiError(400, 'invalid_request', 'multipart part "file" is required');
  let meta = {};
  if (typeof req.body?.meta === 'string') { try { meta = JSON.parse(req.body.meta); } catch {} }
  try { res.status(201).json({ media: media.save(f.buffer, f.mimetype, req.device.id, meta) }); }
  catch (e) { throw new ApiError(e.status || 400, e.code || 'invalid_media', e.message); }
}));

function mediaAccess(req, rec) { return rec.ownerDeviceId === req.device.id || can(req, 'media:*') || can(req, 'agent'); }

router.get('/media/:id/info', (req, res) => {
  const rec = media.get(req.params.id);
  if (!rec || !mediaAccess(req, rec)) return sendError(res, 404, 'not_found', 'Unknown media');
  res.json({ media: media.publicView(rec) });
});

router.get('/media/:id', (req, res) => {
  const rec = media.get(req.params.id);
  if (!rec || !mediaAccess(req, rec)) return sendError(res, 404, 'not_found', 'Unknown media');
  const buf = media.readBuffer(rec.id);
  if (!buf) return sendError(res, 404, 'not_found', 'Media content missing');
  res.setHeader('Content-Type', rec.mime); res.setHeader('Content-Length', buf.length); res.setHeader('ETag', `"${rec.sha256.slice(0, 16)}"`);
  res.end(buf);
});

// ─── Artifacts (device side) ────────────────────────────────────────────────

function artifactFor(req, res) {
  const rec = artifacts.get(req.params.id);
  if (!rec) { sendError(res, 404, 'not_found', 'Unknown artifact'); return null; }
  const wildcard = can(req, 'artifacts:*') || can(req, 'agent');
  if (!wildcard && !can(req, 'artifacts:self')) { sendError(res, 403, 'scope_required', 'Requires artifacts:self', { required: ['artifacts:self'] }); return null; }
  if (!artifacts.visibleTo(rec, req.device, wildcard)) { sendError(res, 404, 'not_found', 'Unknown artifact'); return null; }
  return rec;
}
router.get('/artifacts/:id', (req, res) => { const rec = artifactFor(req, res); if (rec) res.json({ artifact: artifacts.publicView(rec) }); });
router.get('/artifacts/:id/content', (req, res) => {
  const rec = artifactFor(req, res); if (!rec) return;
  const buf = artifacts.readBuffer(rec.id);
  res.setHeader('Content-Type', rec.mime); res.setHeader('ETag', `"${rec.sha256.slice(0, 16)}"`); res.setHeader('X-Doca-Runtime', rec.runtime);
  res.end(buf);
});

// ─── Render ─────────────────────────────────────────────────────────────────

const screenDefaults = req => ({ w: req.device.caps?.screen ? Math.min(req.device.caps.screen.w, 480) : 320, h: req.device.caps?.screen ? Math.min(req.device.caps.screen.h, 480) : 160, round: req.device.caps?.screen?.shape === 'round' });
const dim = (v, d, max = 1024) => Math.min(max, Math.max(16, parseInt(v, 10) || d));

router.get('/render/chart', wrap(async (req, res) => {
  const metrics = String(req.query.metrics || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
  if (!metrics.length) throw new ApiError(400, 'invalid_request', 'metrics=<id,id> is required');
  for (const m of metrics) {
    const surfaceId = m.split('.').slice(0, 2).join('.');
    if (!hasScope(req.device.scopes, `read:${surfaceId}`)) throw new ApiError(403, 'scope_required', `Requires read:${surfaceId}`, { required: [`read:${surfaceId}`] });
  }
  sampler.demand(10);
  const d = screenDefaults(req);
  const w = dim(req.query.w, d.w), h = dim(req.query.h, Math.round(d.h / 2) || 160);
  const svg = render.chartSvg({ metrics, w, h, theme: req.query.theme, rangeSec: Math.min(24 * 3600, parseInt(req.query.rangeSec, 10) || 3600), title: req.query.title, unit: req.query.unit, round: req.query.round === '1', labels: typeof req.query.labels === 'string' ? req.query.labels.split(',') : undefined, thresholds: req.query.thresholds ? safeThresholds(req.query.thresholds) : undefined, min: req.query.min != null ? Number(req.query.min) : undefined, max: req.query.max != null ? Number(req.query.max) : undefined });
  if (req.query.format === 'svg' && (req.device.caps?.render || []).includes('svg')) { res.type('image/svg+xml').send(svg); return; }
  const png = await render.svgToPng(svg, { w });
  res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'private, max-age=5'); res.end(png);
}));

function safeThresholds(s) { try { const t = JSON.parse(s); return Array.isArray(t) ? t.slice(0, 4) : undefined; } catch { return undefined; } }

router.get('/render/figure/:id', wrap(async (req, res) => {
  const fig = motion.getFigure(req.params.id);
  if (!fig || !fig.svg) throw new ApiError(404, 'not_found', 'Unknown figure or figure has no SVG representation');
  const d = screenDefaults(req);
  const w = dim(req.query.w, Math.min(d.w, 240)), h = dim(req.query.h, Math.min(d.h, 240));
  const frames = Math.min(16, Math.max(1, parseInt(req.query.frames, 10) || 1));
  if (req.query.format === 'svg' && (req.device.caps?.render || []).includes('svg')) { res.type('image/svg+xml').send(fig.svg); return; }
  let svg, meta = {};
  if (frames > 1) { const s = render.spriteSvg(fig.svg, { frames, w, h }); svg = s.svg; meta = { frames: s.frames, totalMs: s.totalMs }; res.setHeader('X-Doca-Frames', String(s.frames)); res.setHeader('X-Doca-Duration-Ms', String(s.totalMs)); }
  else svg = render.posterSvg(fig.svg, { w, h });
  const png = await render.svgToPng(svg, { w: w * (meta.frames || 1) });
  res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'private, max-age=300'); res.end(png);
}));

// ─── Talking to the agent (device → harness) ────────────────────────────────
//
// The mirror image of the agent-facing API below: there, a client *is* the agent
// acting on devices; here, a device asks the agent for something. Different
// direction, different scope family, so a separate prefix — `/agent` was already
// taken by the other direction, and one prefix meaning both would be a trap.

const harnessApi = express.Router();

harnessApi.post('/messages', requireScope('harness:chat'), wrap(async (req, res) =>
  res.status(202).json(harness.post(req.body, req.device))));

// So a client that opens mid-turn can draw "typing" without waiting for an event.
harnessApi.get('/turns', requireScope('harness:chat'), (_req, res) =>
  res.json({ turns: harness.running() }));

harnessApi.get('/sessions', requireScope('harness:sessions'), (_req, res) =>
  res.json(harness.sessions()));
harnessApi.post('/sessions', requireScope('harness:sessions'), wrap(async (req, res) =>
  res.status(201).json({ session: harness.createSession(req.body?.title) })));
harnessApi.get('/sessions/:id', requireScope('harness:sessions'), wrap(async (req, res) =>
  res.json(harness.transcript(req.params.id, { limit: req.query.limit }))));
harnessApi.post('/sessions/:id/activate', requireScope('harness:sessions'), wrap(async (req, res) =>
  res.json({ ok: true, active: harness.activate(req.params.id) })));
harnessApi.delete('/sessions/:id', requireScope('harness:sessions'), wrap(async (req, res) => {
  harness.removeSession(req.params.id);
  res.json({ ok: true });
}));

// Read-only on purpose: the agent may propose, and only a click in the dashboard
// writes prefs. A device that could apply a proposal would make that rule empty.
harnessApi.get('/memory', requireScope('harness:memory'), (_req, res) =>
  res.json(harness.memoryList()));

router.use('/harness', harnessApi);

// ─── Agent-facing API ───────────────────────────────────────────────────────

const agent = express.Router();
agent.use(requireScope('agent'));

agent.get('/devices', (_req, res) => res.json({ devices: devices.list().filter(d => !d.revokedAt).map(d => ({ ...d, online: bus.isOnline(d.id), pending: bus.pendingCount(d.id), profile: profiles.effective(profiles.get(d.id), d.scopes) })) }));

agent.post('/prompts', wrap(async (req, res) => {
  const { prompt, created } = prompts.create(req.body, req.device);
  res.status(created ? 201 : 200).json({ prompt: publicPrompt(prompt), created });
}));
agent.get('/prompts', (req, res) => res.json({ prompts: prompts.list({ agentId: can(req, '*') ? undefined : req.device.id, state: req.query.state }).map(publicPrompt) }));
agent.get('/prompts/:id', (req, res) => { const p = prompts.get(req.params.id); if (!p) return sendError(res, 404, 'not_found', 'Unknown prompt'); res.json({ prompt: publicPrompt(p) }); });
agent.delete('/prompts/:id', wrap(async (req, res) => res.json({ prompt: publicPrompt(prompts.cancel(req.params.id, req.device)) })));
agent.post('/prompts/:id/outcome', wrap(async (req, res) => res.json({ outcome: prompts.agentOutcome(req.params.id, req.device, req.body || {}) })));

function publicPrompt(p) {
  const { selections, confirmations, ...rest } = p;
  return { ...rest, selections: Object.entries(selections).map(([id, s]) => ({ selectionId: id, deviceId: s.deviceId, choiceId: s.choiceId, createdAt: s.createdAt })) };
}

agent.post('/alerts', wrap(async (req, res) => {
  const { title, body, priority, targets, ttlSec, ext, haptic } = req.body || {};
  if (!title) throw new ApiError(400, 'invalid_alert', 'title is required');
  const payload = { id: `alt_${require('crypto').randomBytes(6).toString('hex')}`, title: String(title).slice(0, 120), body: motion.normalizeBlocks(body), priority: prompts.PRIORITIES.includes(priority) ? priority : 'normal', haptic: haptic !== false, ext: ext && JSON.stringify(ext).length <= L.EXT_BYTES ? ext : undefined, from: req.device.id };
  const list = devices.list().filter(d => !d.revokedAt && d.id !== req.device.id && hasScope(d.scopes, 'interact') && (!targets || targets.includes(d.id)) && profiles.get(d.id).prompts?.receive !== false);
  const delivered = list.map(d => ({ deviceId: d.id, seq: bus.publish(d.id, 'alert', { ...payload, body: motion.tailorBlocks(payload.body, d.caps) }, { ttlSec: ttlSec || 6 * 3600, priority: payload.priority === 'urgent' ? 'urgent' : 'high' }).seq }));
  res.status(202).json({ alertId: payload.id, delivered });
}));

agent.post('/messages', wrap(async (req, res) => {
  const { type, payload, targets, ttlSec, ext } = req.body || {};
  const body = { from: req.device.id, type: typeof type === 'string' ? type.slice(0, 64) : 'message', payload: payload ?? null, ext };
  if (Buffer.byteLength(JSON.stringify(body)) > L.EVENT_BYTES - 512) throw new ApiError(413, 'payload_too_large', 'Message too large');
  const list = devices.list().filter(d => !d.revokedAt && d.id !== req.device.id && (targets ? targets.includes(d.id) : hasScope(d.scopes, 'interact')));
  res.status(202).json({ delivered: list.map(d => ({ deviceId: d.id, seq: bus.publish(d.id, 'agent.message', body, { ttlSec }).seq })) });
}));

agent.post('/sensors/requests', wrap(async (req, res) => {
  const { deviceId, sensors: list, reason, ext } = req.body || {};
  const d = devices.get(deviceId);
  if (!d || d.revokedAt) throw new ApiError(404, 'not_found', 'Unknown device');
  if (!(d.caps?.sensors || []).length) throw new ApiError(409, 'sensors_unavailable', 'Device declared no sensors');
  const r = sensors.createRequest({ device: d, profile: profiles.get(d.id), sensors: list, reason, requestedBy: req.device.id, ext });
  if (!r.request) throw new ApiError(403, 'sensors_rejected', 'No requested sensor is available and allowed on this device', { rejected: r.rejected });
  res.status(201).json(r);
}));
agent.get('/sensors/requests/:id', (req, res) => {
  const r = sensors.getRequest(req.params.id);
  if (!r) return sendError(res, 404, 'not_found', 'Unknown sensor request');
  res.json({ request: r, samples: sensors.recent(r.deviceId, r.id, parseInt(req.query.limit, 10) || 200) });
});
agent.delete('/sensors/requests/:id', (req, res) => {
  const r = sensors.stopRequest(req.params.id, 'stopped_by_agent');
  if (!r) return sendError(res, 404, 'not_found', 'Unknown sensor request');
  res.json({ request: r });
});

agent.post('/artifacts', wrap(async (req, res) => {
  try { res.status(201).json({ artifact: artifacts.create(req.body, req.device.id) }); }
  catch (e) { throw new ApiError(e.status || 400, e.code || 'invalid_artifact', e.message); }
}));
agent.get('/artifacts', (_req, res) => res.json({ artifacts: artifacts.list() }));
agent.delete('/artifacts/:id', (req, res) => res.json({ removed: artifacts.remove(req.params.id) }));
agent.post('/artifacts/:id/deliver', wrap(async (req, res) => {
  const rec = artifacts.get(req.params.id);
  if (!rec) throw new ApiError(404, 'not_found', 'Unknown artifact');
  const { targets, inline, message, ext } = req.body || {};
  const list = devices.list().filter(d => !d.revokedAt && d.id !== req.device.id && (targets ? targets.includes(d.id) : (!rec.targets || rec.targets.includes(d.id))) && (hasScope(d.scopes, 'artifacts:self') || hasScope(d.scopes, 'artifacts:*')));
  res.status(202).json({ report: artifacts.deliver(rec, list.map(d => devices.get(d.id)), { inline: !!inline, message, ext }) });
}));

router.use('/agent', agent);

router.use((_req, res) => sendError(res, 404, 'not_found', 'No such endpoint under /api/v1'));
router.use(errorMiddleware);

module.exports = { router };
