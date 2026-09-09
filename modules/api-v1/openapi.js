'use strict';

/**
 * OpenAPI 3.1 description of /api/v1, built from the live registries so that
 * enums (commands, event types, block/choice types, limits) never drift from
 * the code. Served unauthenticated at GET /api/v1/openapi.json and checked in
 * as docs/api/openapi.json (`npm run openapi`; test/openapi.test.js keeps the
 * two in sync and cross-checks every Express route against this document).
 *
 * PROTOCOL.md remains the normative prose; this file is the machine-readable
 * companion for client generators, Postman/Insomnia, Swagger UI and linters.
 */
const L          = require('./limits');
const { PRESETS, FAMILIES } = require('./scopes');
const bus        = require('./bus');
const commands   = require('./commands');
const surfaces   = require('./surfaces');
const motion     = require('./motion');
const prompts    = require('./prompts');
const { version: serverVersion } = require('../../package.json');

// ─── Small schema helpers ───────────────────────────────────────────────────

const ref  = name => ({ $ref: `#/components/schemas/${name}` });
const str  = (extra = {}) => ({ type: 'string', ...extra });
const int  = (extra = {}) => ({ type: 'integer', ...extra });
const num  = (extra = {}) => ({ type: 'number', ...extra });
const bool = (extra = {}) => ({ type: 'boolean', ...extra });
const arr  = (items, extra = {}) => ({ type: 'array', items, ...extra });
const obj  = (properties, extra = {}) => ({ type: 'object', properties, ...extra });
const any  = (description) => ({ description });
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const iso  = (description = 'ISO-8601 timestamp') => str({ format: 'date-time', description });
const ext  = () => obj({}, { additionalProperties: true, description: `Opaque client/agent data, stored and forwarded untouched (≤ ${L.EXT_BYTES} bytes).` });

const json = (schema, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const body = (schema, opts = {}) => ({ required: opts.required !== false, content: { 'application/json': { schema } } });
const multipart = (schema, description) => ({ required: true, description, content: { 'multipart/form-data': { schema }, 'application/json': { schema } } });
const err = (description) => ({ description, content: { 'application/json': { schema: ref('Error') } } });

const E = {
  400: err('Malformed input — `error.message` says which field.'),
  401: err('Missing (`unauthenticated`) or unknown/expired/revoked (`invalid_token`) token.'),
  403: err('Authenticated but not allowed (`scope_required` lists `required[]`).'),
  404: err('Not found.'),
  409: err('State machine refused the transition; body includes the current state.'),
  412: err('`etag_mismatch` — the profile changed since it was read (`currentEtag`, `currentVersion`).'),
  413: err('Over a documented payload budget.'),
  500: err('The underlying action failed (`command_failed`) or an internal error occurred.'),
};
const std = (...codes) => Object.fromEntries(codes.map(c => [String(c), E[c]]));

const scopeDoc = s => ({ 'x-scope': s });
const pathParam = (name, description, extra = {}) => ({ name, in: 'path', required: true, description, schema: str(extra) });
const query = (name, description, schema = str()) => ({ name, in: 'query', required: false, description, schema });
const deviceIdParam = pathParam('id', 'Device id, or the literal `me` for the calling device.');

// ─── Components ─────────────────────────────────────────────────────────────

function schemas() {
  const eventTypes = Object.keys(bus.TYPES);
  return {
    Error: obj({
      error: obj({ code: str({ description: 'Stable machine-readable code (see PROTOCOL.md §5).' }), message: str(), required: arr(str(), { description: 'Present on `scope_required`.' }) },
        { required: ['code', 'message'], additionalProperties: true }),
    }, { required: ['error'] }),

    Discovery: obj({
      name: str({ const: 'doca' }), protocol: obj({ version: str(), minClient: str() }), auth: str(), pairUrl: str(), capabilitiesUrl: str(), openapiUrl: str(),
      docs: str({ description: 'Path of the normative specification in the repository.' }), guides: str({ description: 'Path of the developer guides in the repository.' }),
    }),

    Scope: str({ description: '`family:target`; `target` may be `*` or a dotted prefix ending in `.*`. Families: ' + Object.keys(FAMILIES).join(', ') + '.', examples: ['read:*', 'read:system.*', 'command:services.stop', 'interact', 'profile:self', 'agent'] }),

    Caps: obj({
      formFactor: str({ enum: ['watch', 'phone', 'glasses', 'tablet', 'browser', 'headless', 'other'] }),
      protocol: obj({ max: str({ description: 'Highest protocol version the client understands.' }) }),
      screen: nullable(obj({ w: int(), h: int(), shape: str({ enum: ['round', 'rect'] }), dpr: num(), color: bool() }, { description: 'Omit when the device has no display.' })),
      input: obj({ touch: bool(), voice: bool(), text: bool(), camera: bool(), buttons: bool(), gaze: bool(), crown: bool(), gesture: bool() }),
      audio: obj({ mic: bool(), speaker: bool(), haptic: bool() }),
      render: arr(str({ enum: ['svg', 'svg.smil', 'sprite', 'image', 'image.inline', 'text'] }), { description: 'Representations the device can draw; `text` is always implied.' }),
      motion: arr(str(), { description: 'Motion vocabularies understood (currently `"1"`).' }),
      exec: arr(str(), { description: 'Runtimes the device can execute artifacts in (open vocabulary: js, wasm, lua…).' }),
      sensors: arr({ oneOf: [str(), obj({ id: str(), maxRateHz: num(), unit: str() }, { required: ['id'] })] }, { description: 'Sensors the device can report (open vocabulary; see PROTOCOL.md §7 for conventional ids).' }),
      ext: ext(),
    }, { description: 'Self-declared device capabilities. Every section is optional; nothing here is a platform identifier.' }),

    Device: obj({
      id: str({ examples: ['dev_9f4bf9ba62b1'] }), name: str(), kind: str({ enum: ['device', 'agent'] }), scopes: arr(ref('Scope')), caps: ref('Caps'),
      vars: obj({}, { additionalProperties: true }), varsVersion: int(), createdAt: iso(), lastSeenAt: nullable(iso()), expiresAt: nullable(iso()), revokedAt: nullable(iso()),
    }),

    TokenIssue: obj({ token: str({ description: 'Shown once. `doca_<deviceId>.<secret>`.' }), device: ref('Device') }, { required: ['token', 'device'] }),

    Threshold: obj({ level: str({ enum: ['warn', 'crit'] }), gte: num() }, { required: ['level', 'gte'] }),
    MetricDefinition: obj({
      id: str(), label: str(), kind: str({ enum: surfaces.KINDS }), unit: str({ enum: surfaces.UNITS }), min: num(), max: num(), thresholds: arr(ref('Threshold')), values: arr(str(), { description: 'For `enum` metrics.' }),
    }),
    Metric: {
      allOf: [ref('MetricDefinition'), obj({
        value: any('Typed by `kind`; `null` when the collector had nothing.'), display: str({ description: 'Server-formatted string, always present.' }),
        observedAt: iso(), ttlSec: int(), stale: bool(), spark: arr(num(), { maxItems: L.SPARK_MAX_POINTS }),
      })],
    },
    Item: obj({ id: str(), label: str(), state: str({ enum: surfaces.STATES }), detail: str(), metrics: arr(ref('Metric')), commands: arr(ref('CommandInvocation')) }),
    CommandInvocation: obj({ id: str(), params: obj({}, { additionalProperties: true }) }, { required: ['id'] }),
    SurfaceDefinition: obj({
      id: str({ examples: ['system.cpu', 'docker.containers', 'gpu.0'] }), title: str(), kind: str({ enum: ['metrics', 'list'] }), group: str(), refreshHintSec: int(),
      metrics: arr(ref('MetricDefinition')), itemMetrics: arr(ref('MetricDefinition')), commands: arr(str()), itemCommands: arr(str()),
    }),
    Surface: obj({
      id: str(), title: str(), kind: str({ enum: ['metrics', 'list'] }), observedAt: iso(), ttlSec: int(), stale: bool(),
      metrics: arr(ref('Metric')), items: arr(ref('Item')), truncated: int({ description: 'Total item count when the list was cut at 40.' }),
    }),
    Snapshot: obj({ surfaces: arr(ref('Surface')), observedAt: iso(), stale: bool() }),

    CommandParam: obj({ type: str(), required: bool(), enum: arr(str()), maxLength: int() }),
    Command: obj({
      id: str({ enum: commands.ids() }), title: str(), scope: str(), params: obj({}, { additionalProperties: ref('CommandParam') }),
      confirm: bool({ description: 'The client should ask before posting.' }), longRunning: bool({ description: 'Returns a job (202) instead of a result.' }),
    }),
    CommandResult: obj({ status: str({ const: 'done' }), commandId: str(), result: any('Command-specific result.'), replay: bool() }),
    JobStarted: obj({ status: str({ const: 'running' }), jobId: str(), commandId: str(), jobUrl: str(), replay: bool() }),
    Job: obj({ id: str(), commandId: str(), status: str({ enum: ['running', 'done', 'failed'] }), startedAt: iso(), endedAt: nullable(iso()), result: any(), error: nullable(str()), outputTail: arr(str()) }),

    EventEnvelope: obj({
      seq: int({ description: 'Per-device monotonic sequence — your cursor.' }), id: str(), ts: iso(), type: str({ enum: eventTypes }),
      class: str({ enum: ['durable', 'ephemeral'] }), ttlSec: int(), priority: str({ enum: prompts.PRIORITIES }), ack: bool(), v: int({ const: 1 }), payload: obj({}, { additionalProperties: true }),
    }, { required: ['seq', 'id', 'ts', 'type', 'class', 'v', 'payload'], description: 'See `x-events` for per-type payloads.' }),
    EventPoll: obj({ events: arr(ref('EventEnvelope')), nextSince: int(), resync: bool(), retryAfterSec: int() }),

    Block: {
      description: 'Rich content unit used in prompt bodies, outcomes and alerts. Unknown types must be skipped.',
      oneOf: [
        obj({ type: str({ const: 'text' }), text: str({ maxLength: 2000 }), style: str({ enum: ['body', 'title', 'caption', 'code'] }), ext: ext() }, { required: ['type', 'text'] }),
        obj({ type: str({ const: 'metric' }), metric: str(), label: str(), ext: ext() }, { required: ['type', 'metric'] }),
        obj({ type: str({ const: 'figure' }), id: str(), alt: str(), svg: str({ description: 'Authoring only (≤ 64 KB).' }), motion: ref('MotionScene'), image: obj({ url: str(), w: int(), h: int() }), text: str(), sizeHint: obj({ w: int(), h: int() }), representation: ref('FigureRepresentation'), ext: ext() }, { required: ['type'] }),
        obj({ type: str({ const: 'image' }), url: str(), alt: str(), w: int(), h: int(), ext: ext() }, { required: ['type', 'url'] }),
        obj({ type: str({ const: 'media' }), mediaId: str(), url: str(), alt: str(), ext: ext() }, { required: ['type', 'mediaId'] }),
        obj({ type: str({ const: 'artifact' }), artifactId: str(), runtime: str(), url: str(), contentUrl: str(), alt: str(), ext: ext() }, { required: ['type', 'artifactId'] }),
        obj({ type: str({ const: 'list' }), items: arr(str(), { maxItems: 20 }), ext: ext() }, { required: ['type', 'items'] }),
        obj({ type: str({ const: 'kv' }), items: arr(obj({ k: str({ maxLength: 48 }), v: str({ maxLength: 120 }) })), ext: ext() }, { required: ['type', 'items'] }),
      ],
      'x-block-types': motion.BLOCK_TYPES,
    },
    FigureRepresentation: {
      description: 'Exactly one representation per device, chosen from `caps.render`/`caps.motion` (PROTOCOL.md §19.4).',
      oneOf: [
        obj({ kind: str({ const: 'svg' }), svg: str(), animated: bool() }, { required: ['kind', 'svg'] }),
        obj({ kind: str({ const: 'motion' }), scene: ref('MotionScene') }, { required: ['kind', 'scene'] }),
        obj({ kind: str({ const: 'sprite' }), url: str(), frames: int(), fps: int(), w: int(), h: int(), loop: bool() }, { required: ['kind', 'url', 'frames'] }),
        obj({ kind: str({ const: 'image' }), url: str(), w: int(), h: int() }, { required: ['kind', 'url'] }),
        obj({ kind: str({ const: 'text' }), text: str() }, { required: ['kind', 'text'] }),
      ],
    },
    MotionScene: obj({
      vocab: str({ const: motion.MOTION_VOCAB }), loop: bool(), caption: str(),
      tracks: arr(obj({
        type: str({ enum: ['morph', 'ring', 'reveal', 'pulse', 'sequence'] }), target: str(), from: num(), to: num(), durationMs: int({ minimum: 50, maximum: 10000 }), delayMs: int(),
        easing: str({ enum: motion.EASINGS }), color: str({ enum: motion.COLOR_ROLES }), unit: str(), mode: str(), count: int(), periodMs: int(), steps: arr(obj({}, { additionalProperties: true })),
      })),
    }, { description: 'Motion vocabulary `1` — five primitives that map onto native animation APIs (PROTOCOL.md §19.5).' }),

    Outcome: obj({
      summary: str({ maxLength: 200 }), detail: str({ maxLength: 1000 }), blocks: arr(ref('Block')),
      action: nullable(ref('CommandInvocation')), confirmLabel: str({ maxLength: 24 }), backLabel: str({ maxLength: 24 }),
      actionAllowed: bool({ description: 'Device view only: whether *this* token could confirm `action`.' }), ext: ext(),
    }, { required: ['summary'] }),
    ChoiceAuthoring: obj({
      id: str(), type: str({ enum: prompts.CHOICE_TYPES }), label: str(),
      outcome: ref('Outcome'), maxSec: int({ description: '`voice` only.' }), maxChars: int({ description: '`text` only.' }), placeholder: str(), ext: ext(),
    }, { required: ['id', 'type'], description: '`option` requires `outcome`.' }),
    Choice: { allOf: [ref('ChoiceAuthoring'), obj({ accept: arr(str(), { description: 'Accepted mime types for `voice`/`image` uploads.' }) })] },
    PromptCreate: obj({
      id: str({ description: 'Optional idempotency id; the same id returns the existing prompt.' }), title: str({ maxLength: 120 }), priority: str({ enum: prompts.PRIORITIES }),
      targets: arr(str(), { description: 'Device ids; omit for every device with `interact`.' }), ttlSec: int({ minimum: 30, maximum: 7 * 24 * 3600, default: L.PROMPT_DEFAULT_TTL_SEC }),
      resolver: str({ enum: ['server', 'agent'], default: 'server' }), allowedCommands: arr(str()), body: arr(ref('Block')), choices: arr(ref('ChoiceAuthoring'), { maxItems: L.PROMPT_MAX_CHOICES }), ext: ext(),
    }, { required: ['title', 'choices'] }),
    Prompt: obj({
      id: str(), createdAt: iso(), expiresAt: iso(), priority: str({ enum: prompts.PRIORITIES }), title: str(), body: arr(ref('Block')), choices: arr(ref('Choice')),
      resolver: str({ enum: ['server', 'agent'] }), state: str({ enum: ['open', 'pending', 'outcome_ready', 'confirmed', 'dismissed', 'closed'] }),
      selectionId: nullable(str()), choiceId: nullable(str()), stage: nullable(str({ enum: ['transcribing', 'thinking'] })), outcome: nullable(ref('Outcome')),
      error: nullable(obj({ code: str(), message: str() })), haptic: bool(), ext: ext(),
    }, { description: 'Device-tailored view: choices this device cannot perform are removed, figures collapsed to one representation.' }),
    AgentPrompt: obj({
      id: str(), title: str(), state: str({ enum: ['open', 'confirmed', 'cancelled', 'expired'] }), targets: nullable(arr(str())), delivered: arr(obj({ deviceId: str(), seq: int() })),
      selections: arr(obj({ selectionId: str(), deviceId: str(), choiceId: str(), createdAt: iso() })),
    }, { additionalProperties: true, description: 'Stored prompt as seen by the agent (all fields of the create body plus lifecycle state).' }),
    SelectionPayload: obj({
      kind: str({ enum: ['option', 'text', 'voice', 'image'] }), text: str({ description: '`text`.' }), transcript: str({ description: '`voice` with on-device STT.' }),
      durationMs: int(), caption: str({ description: '`image`.' }), mediaId: str({ description: '`image` referencing an earlier upload.' }), w: int(), h: int(), ext: ext(),
    }),
    SelectRequest: obj({ selectionId: str({ description: 'Client-generated UUID keying the whole cycle.' }), choiceId: str(), payload: ref('SelectionPayload'),
      audio: str({ format: 'binary', description: 'multipart only' }), image: str({ format: 'binary', description: 'multipart only' }), file: str({ format: 'binary', description: 'multipart only' }) }, { required: ['selectionId', 'choiceId'] }),
    SelectResponse: obj({
      status: str({ enum: ['outcome_ready', 'pending', 'dismissed'] }), promptId: str(), selectionId: str(), outcome: ref('Outcome'),
      stage: str({ enum: ['transcribing', 'thinking'] }), expectedWithinSec: int(), pollUrl: str(), replay: bool(),
    }),
    ConfirmRequest: obj({ selectionId: str(), decision: str({ enum: ['confirm', 'back'] }) }, { required: ['selectionId', 'decision'] }),
    ConfirmResponse: obj({
      status: str({ enum: ['confirmed', 'open'] }), promptId: str(), selectionId: str(), replay: bool(),
      execution: nullable(obj({ status: str({ enum: ['done', 'running', 'failed'] }), jobId: str(), result: any(), error: str() })),
    }),

    Profile: obj({
      version: int(), etag: str(), refreshSec: int({ minimum: L.SAMPLER_MIN_INTERVAL_SEC, maximum: 3600 }),
      quietHours: nullable(obj({ from: str({ pattern: '^\\d{2}:\\d{2}$' }), to: str({ pattern: '^\\d{2}:\\d{2}$' }), allowUrgent: bool() })),
      pages: arr(obj({ id: str(), title: str(), surfaces: arr({ oneOf: [str(), obj({ id: str(), metrics: arr(str()), spark: bool(), maxItems: int(), commands: arr(str()) }, { required: ['id'] })] }) })),
      commands: arr(str()), prompts: obj({ receive: bool(), haptic: bool(), allowVoice: bool(), allowText: bool(), allowImage: bool() }),
      sensors: obj({ allow: arr(str()), autoReport: arr(str()) }), artifacts: arr(str()), ext: ext(),
      warnings: arr(obj({ code: str({ enum: ['surface_not_in_scope', 'command_not_in_scope'] }), id: str() }), { description: 'Effective view only.' }),
    }, { description: 'What a device shows and may do — never how it looks. Returned profiles are *effective* (filtered by the device scopes).' }),
    ProfileWrite: obj({
      refreshSec: int(), quietHours: nullable(obj({ from: str(), to: str(), allowUrgent: bool() })), pages: arr(obj({}, { additionalProperties: true })), commands: arr(str()),
      prompts: obj({}, { additionalProperties: true }), sensors: obj({ allow: arr(str()), autoReport: arr(str()) }), artifacts: arr(str()), ext: ext(),
    }),
    Vars: obj({ deviceId: str(), vars: obj({}, { additionalProperties: true }), version: int(), updatedAt: nullable(iso()) }),

    Sample: obj({ sensor: str(), ts: iso(), value: num(), values: arr(num(), { maxItems: 16 }), accuracy: num(), ext: ext() }, { required: ['sensor'], description: 'One of `value`, `values` or `ext`.' }),
    SensorSpec: { oneOf: [str(), obj({ id: str(), rateHz: num({ maximum: L.SENSOR_MAX_RATE_HZ }), durationSec: int({ maximum: L.SENSOR_MAX_DURATION_SEC }), mode: str({ enum: ['stream', 'once'] }) }, { required: ['id'] })] },
    SensorRequest: obj({
      id: str(), deviceId: str(), sensors: arr(obj({ id: str(), mode: str({ enum: ['stream', 'once'] }), rateHz: num(), durationSec: int(), unit: nullable(str()) })),
      reason: str(), ext: ext(), status: str({ enum: ['active', 'stopped', 'expired'] }), expiresAt: iso(), sampleCount: int(), requestedBy: str(),
    }),

    Media: obj({ id: str(), mime: str(), kind: str({ enum: ['image', 'audio', 'other'] }), bytes: int(), sha256: str(), ownerDeviceId: str(), meta: obj({}, { additionalProperties: true }), createdAt: iso(), expiresAt: iso(), url: str() }),

    ArtifactCreate: obj({
      name: str(), runtime: str({ description: 'Must match a target device `caps.exec` entry to be delivered.' }), mime: str(), entry: str(), params: obj({}, { additionalProperties: true }), purpose: str(),
      targets: nullable(arr(str())), ttlSec: int(), content: str({ description: 'UTF-8 content' }), contentBase64: str({ description: 'Binary content' }), ext: ext(),
    }, { required: ['name', 'runtime'] }),
    Artifact: obj({
      id: str(), name: str(), runtime: str(), mime: str(), bytes: int({ maximum: L.ARTIFACT_BYTES }), sha256: str(), entry: str(), params: obj({}, { additionalProperties: true }), purpose: str(),
      targets: nullable(arr(str())), ext: ext(), createdAt: iso(), expiresAt: nullable(iso()), url: str(), contentUrl: str(),
    }),

    Capabilities: obj({
      protocol: obj({ version: str(), minClient: str(), clientMax: str(), motionVocabulary: str(), blockTypes: arr(str()), choiceTypes: arr(str()), priorities: arr(str()), eventTypes: arr(obj({ type: str(), class: str() })), metricKinds: arr(str()), units: arr(str()), itemStates: arr(str()), easings: arr(str()), colorRoles: arr(str()) }),
      server: obj({ name: str(), version: str(), time: iso() }), device: ref('Device'),
      scopes: obj({ granted: arr(ref('Scope')), families: obj({}, { additionalProperties: str() }) }),
      surfaces: arr(ref('SurfaceDefinition')), commands: arr(ref('Command')),
      push: obj({ url: str(), ackUrl: str(), heartbeatSec: int(), retainedEvents: int(), retainedHours: int(), cursor: int(), pending: int(), backoff: obj({ initialMs: int(), maxMs: int(), factor: num(), jitter: num() }) }),
      render: obj({ formats: arr(str()), maxImageBytes: int(), themes: arr(str()), text: bool(), chartUrl: str(), figureUrl: str(), defaults: obj({ w: int(), h: int(), round: bool() }) }),
      limits: obj({}, { additionalProperties: int() }),
      profile: obj({ version: int(), etag: str(), url: str(), warnings: arr(obj({}, { additionalProperties: true })) }),
      vars: obj({ version: int(), url: str() }),
      sensors: obj({ declared: arr(obj({ id: str(), unit: nullable(str()), maxRateHz: nullable(num()) })), allowed: arr(str()), autoReport: arr(str()), reportUrl: str() }),
      media: obj({ uploadUrl: str(), accept: arr(str()) }), artifacts: obj({ url: str(), runtimes: arr(str()) }),
      prompts: obj({ url: str(), open: int(), receive: bool() }), messages: obj({ url: str() }),
      deprecations: arr(obj({ path: str(), until: str(), note: str() })),
    }, { description: 'Already filtered by the token scopes and shaped by the device caps: a client can build its whole UI from this.' }),
  };
}

// ─── Push event catalogue (x-events) ────────────────────────────────────────

function events() {
  const P = {
    'surface.update':   { audience: 'device', payload: obj({ surface: ref('Surface') }), note: 'At the profile `refreshSec`, only for surfaces listed in `profile.pages`.' },
    'job.progress':     { audience: 'device', payload: obj({ jobId: str(), commandId: str(), text: str() }) },
    'job.done':         { audience: 'device', payload: obj({ jobId: str(), commandId: str(), status: str({ enum: ['done', 'failed'] }), error: nullable(str()), result: any(), outputTail: arr(str()) }) },
    'prompt.new':       { audience: 'device', payload: obj({ prompt: ref('Prompt') }) },
    'prompt.progress':  { audience: 'device', payload: obj({ promptId: str(), selectionId: str(), stage: str({ enum: ['transcribing', 'thinking'] }) }) },
    'prompt.outcome':   { audience: 'device', payload: obj({ promptId: str(), selectionId: str(), status: str({ enum: ['outcome_ready', 'failed'] }), outcome: ref('Outcome'), error: obj({ code: str(), message: str() }) }) },
    'prompt.closed':    { audience: 'device', payload: obj({ promptId: str(), reason: str({ enum: ['confirmed_elsewhere', 'cancelled', 'expired'] }) }) },
    'alert':            { audience: 'device', payload: obj({ id: str(), title: str(), body: arr(ref('Block')), priority: str({ enum: prompts.PRIORITIES }), haptic: bool(), from: str(), ext: ext() }) },
    'profile.changed':  { audience: 'device', payload: obj({ version: int(), etag: str(), updatedBy: str(), url: str() }), note: 'Refetch the profile (and capabilities).' },
    'agent.message':    { audience: 'device', payload: obj({ from: str(), type: str(), payload: any(), ext: ext() }) },
    'artifact.deliver': { audience: 'device', payload: obj({ artifact: ref('Artifact'), inline: str(), inlineEncoding: str({ enum: ['utf8', 'base64'] }), message: str(), ext: ext() }), note: 'Verify `artifact.sha256` before executing.' },
    'sensor.request':   { audience: 'device', payload: obj({ request: ref('SensorRequest') }) },
    'sensor.stop':      { audience: 'device', payload: obj({ requestId: str(), reason: str() }) },
    'revoked':          { audience: 'device', payload: obj({ reason: str(), by: str() }), note: 'Followed by an SSE `close` frame; forget the token.' },
    'resync':           { audience: 'device', payload: obj({ reason: str(), cursor: int() }), note: 'Your cursor predates retained history: refetch capabilities, prompts and snapshot, then continue from `cursor`.' },
    'prompt.selected':  { audience: 'agent', payload: obj({ promptId: str(), selectionId: str(), deviceId: str(), choiceId: str(), payload: ref('SelectionPayload'), resolver: str() }), note: 'Only with `resolver: "agent"`; answer via POST /agent/prompts/{id}/outcome.' },
    'prompt.confirmed': { audience: 'agent', payload: obj({ promptId: str(), deviceId: str(), selectionId: str(), choiceId: str(), input: any(), outcome: ref('Outcome'), execution: any() }) },
    'prompt.dismissed': { audience: 'agent', payload: obj({ promptId: str(), deviceId: str(), selectionId: str() }) },
    'prompt.expired':   { audience: 'agent', payload: obj({ promptId: str() }) },
    'device.vars':      { audience: 'agent', payload: obj({ deviceId: str(), vars: obj({}, { additionalProperties: true }), version: int(), updatedAt: iso(), changed: arr(str()) }) },
    'device.message':   { audience: 'agent', payload: obj({ from: str(), type: str(), payload: any(), ext: ext() }) },
    'sensor.samples':   { audience: 'agent', payload: obj({ deviceId: str(), requestId: str(), samples: arr(ref('Sample')) }) },
  };
  const out = {};
  for (const [type, def] of Object.entries(bus.TYPES)) {
    const p = P[type] || { audience: 'device', payload: obj({}, { additionalProperties: true }) };
    out[type] = { class: def.cls, ttlSec: def.ttlSec, priority: def.priority, audience: p.audience, payload: p.payload, ...(p.note ? { note: p.note } : {}) };
  }
  return out;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

function paths() {
  const idem = { idempotencyKey: str({ description: 'Client UUID; a retry with the same key replays the original response with `replay: true`.' }) };
  return {
    '/': { get: { tags: ['Discovery'], summary: 'Discovery (no auth)', operationId: 'discover', security: [], responses: { 200: json(ref('Discovery')), 404: E[404] } } },
    '/openapi.json': { get: { tags: ['Discovery'], summary: 'This document (no auth)', operationId: 'openapi', security: [], responses: { 200: { description: 'OpenAPI 3.1 document', content: { 'application/json': { schema: obj({}, { additionalProperties: true }) } } }, 404: E[404] } } },
    '/capabilities': { get: { tags: ['Discovery'], summary: 'Capability discovery — the first call after authentication', operationId: 'getCapabilities', responses: { 200: json(ref('Capabilities')), ...std(401) } } },

    '/devices/pair/complete': { post: { tags: ['Devices'], summary: 'Finish pairing with a six-digit code → token (no auth)', operationId: 'completePairing', security: [],
      requestBody: body(obj({ code: str({ examples: ['641-598'] }), name: str(), caps: ref('Caps') }, { required: ['code'] })),
      responses: { 201: json(obj({ token: str(), device: ref('Device'), capabilitiesUrl: str(), protocol: str() })), ...std(400) } } },
    '/devices/pair/start': { post: { tags: ['Devices'], summary: 'Start pairing a new device', operationId: 'startPairing', ...scopeDoc('devices:admin'),
      requestBody: body(obj({ name: str(), preset: str({ enum: Object.keys(PRESETS), default: 'watch' }), scopes: arr(ref('Scope')), expiresAt: iso(), kind: str({ enum: ['device', 'agent'] }) })),
      responses: { 201: json(obj({ code: str(), expiresAt: iso(), scopes: arr(ref('Scope')), name: str(), completeUrl: str(), qr: str({ description: '`doca://pair?code=…&host=…`' }) })), ...std(400, 401, 403) } } },
    '/devices': {
      get: { tags: ['Devices'], summary: 'List devices (with presets and scope families)', operationId: 'listDevices', ...scopeDoc('devices:admin | agent'),
        responses: { 200: json(obj({ devices: arr({ allOf: [ref('Device'), obj({ online: bool(), pending: int() })] }), presets: obj({}, { additionalProperties: arr(ref('Scope')) }), scopeFamilies: obj({}, { additionalProperties: str() }) })), ...std(401, 403) } },
      post: { tags: ['Devices'], summary: 'Issue a token directly (no pairing)', operationId: 'createDevice', ...scopeDoc('devices:admin'),
        requestBody: body(obj({ name: str(), preset: str({ enum: Object.keys(PRESETS) }), scopes: arr(ref('Scope')), caps: ref('Caps'), expiresAt: iso(), kind: str({ enum: ['device', 'agent'] }) }, { required: ['name'] })),
        responses: { 201: json(ref('TokenIssue')), ...std(400, 401, 403) } },
    },
    '/devices/{id}': {
      parameters: [deviceIdParam],
      get: { tags: ['Devices'], summary: 'Device record', operationId: 'getDevice', ...scopeDoc('self | devices:admin | agent'), responses: { 200: json(obj({ device: ref('Device'), online: bool(), pending: int() })), ...std(401, 403, 404) } },
      patch: { tags: ['Devices'], summary: 'Update own name/caps (admin: also scopes, expiry)', operationId: 'patchDevice', ...scopeDoc('self | devices:admin'),
        requestBody: body(obj({ name: str(), caps: ref('Caps'), scopes: arr(ref('Scope')), expiresAt: nullable(iso()) })), responses: { 200: json(obj({ device: ref('Device') })), ...std(400, 401, 403, 404) } },
      delete: { tags: ['Devices'], summary: 'Revoke a device (token dies, streams close, outbox and profile deleted)', operationId: 'revokeDevice', ...scopeDoc('devices:admin'),
        responses: { 200: json(obj({ ok: bool(), deviceId: str(), revokedAt: iso() })), ...std(400, 401, 403, 404) } },
    },
    '/devices/{id}/rotate': { parameters: [deviceIdParam], post: { tags: ['Devices'], summary: 'Rotate the token (old one valid for a grace period)', operationId: 'rotateToken', ...scopeDoc('self | devices:admin'),
      responses: { 200: json(obj({ token: str(), device: ref('Device'), previousValidUntil: iso() })), ...std(401, 403, 404) } } },

    '/devices/{id}/profile': {
      parameters: [deviceIdParam],
      get: { tags: ['Profiles'], summary: 'Effective profile (ETag; 304 on If-None-Match)', operationId: 'getProfile', ...scopeDoc('self | profile:* | agent'),
        parameters: [{ name: 'If-None-Match', in: 'header', schema: str() }], responses: { 200: { ...json(obj({ profile: ref('Profile') })), headers: { ETag: { schema: str() } } }, 304: { description: 'Not modified' }, ...std(401, 403, 404) } },
      put: { tags: ['Profiles'], summary: 'Replace the profile (optimistic concurrency with If-Match)', operationId: 'putProfile', ...scopeDoc('profile:self (own) | profile:*'),
        parameters: [{ name: 'If-Match', in: 'header', schema: str(), description: 'ETag from the last GET; `*` or omitted to overwrite.' }], requestBody: body(ref('ProfileWrite')),
        responses: { 200: { ...json(obj({ profile: ref('Profile') })), headers: { ETag: { schema: str() } } }, ...std(400, 401, 403, 404, 412) } },
    },
    '/devices/{id}/vars': {
      parameters: [deviceIdParam],
      get: { tags: ['Variables'], summary: 'Read the free-form variables document', operationId: 'getVars', ...scopeDoc('self | vars:* | agent'), responses: { 200: json(ref('Vars')), ...std(401, 403, 404) } },
      patch: { tags: ['Variables'], summary: 'Merge keys into the variables document (`null` deletes)', operationId: 'patchVars', ...scopeDoc('vars:self (own) | vars:*'),
        requestBody: body(obj({}, { additionalProperties: true })), responses: { 200: json(ref('Vars')), ...std(401, 403, 404, 413) } },
    },
    '/devices/{id}/sensors': { parameters: [deviceIdParam], get: { tags: ['Sensors'], summary: 'Declared sensors and latest sample per sensor', operationId: 'getDeviceSensors', ...scopeDoc('self | sensors:* | agent'),
      responses: { 200: json(obj({ deviceId: str(), declared: arr({}), latest: obj({}, { additionalProperties: ref('Sample') }) })), ...std(401, 403, 404) } } },
    '/sensors/samples': { post: { tags: ['Sensors'], summary: 'Report a batch of samples for an active request (or `autoReport` sensors)', operationId: 'postSamples', ...scopeDoc('sensors:report | sensors:*'),
      requestBody: body(obj({ requestId: str(), samples: arr(ref('Sample'), { maxItems: L.SENSOR_BATCH_MAX }) }, { required: ['samples'] })),
      responses: { 200: json(obj({ accepted: int(), rejected: arr(obj({ sensor: str(), reason: str() })) })), ...std(400, 401, 403, 404) } } },

    '/surfaces': { get: { tags: ['Surfaces'], summary: 'Surface definitions readable by this token', operationId: 'listSurfaces', ...scopeDoc('read:<surface>'),
      responses: { 200: json(obj({ surfaces: arr(ref('SurfaceDefinition')), observedAt: iso() })), ...std(401) } } },
    '/surfaces/{id}': { parameters: [pathParam('id', 'Surface id, e.g. `system.cpu`.')], get: { tags: ['Surfaces'], summary: 'One surface with current values', operationId: 'getSurface', ...scopeDoc('read:<id>'),
      parameters: [query('spark', 'Include sparkline arrays', str({ enum: ['1', 'true'] }))], responses: { 200: json(obj({ surface: ref('Surface'), observedAt: iso(), stale: bool() })), ...std(401, 403, 404) } } },
    '/snapshot': { get: { tags: ['Surfaces'], summary: 'Snapshot of several surfaces (ETag; 304 on If-None-Match)', operationId: 'getSnapshot', ...scopeDoc('read:<surface>'),
      parameters: [query('surfaces', 'Comma-separated surface ids; omit for everything readable.'), query('spark', 'Include sparkline arrays', str({ enum: ['1', 'true'] })), query('sparkPoints', `≤ ${L.SPARK_MAX_POINTS}`, int()), { name: 'If-None-Match', in: 'header', schema: str() }],
      responses: { 200: { ...json(ref('Snapshot')), headers: { ETag: { schema: str() } } }, 304: { description: 'Not modified' }, ...std(401, 413) } } },

    '/commands': { get: { tags: ['Commands'], summary: 'Commands this token may run', operationId: 'listCommands', responses: { 200: json(obj({ commands: arr(ref('Command')) })), ...std(401) } } },
    '/commands/{id}': { parameters: [pathParam('id', 'Command id.', { enum: commands.ids() })], post: { tags: ['Commands'], summary: 'Run a command (long-running ones return a job)', operationId: 'runCommand', ...scopeDoc('command:<id>'),
      requestBody: body(obj({ params: obj({}, { additionalProperties: true }), ...idem }), { required: false }),
      responses: { 200: json(ref('CommandResult')), 202: json(ref('JobStarted'), 'Job started'), ...std(400, 401, 403, 404, 500) } } },
    '/jobs/{id}': { parameters: [pathParam('id', 'Job id.')], get: { tags: ['Commands'], summary: 'Job status for clients without a stream', operationId: 'getJob', ...scopeDoc('owner | agent | devices:admin'), responses: { 200: json(obj({ job: ref('Job') })), ...std(401, 404) } } },

    '/events': { get: { tags: ['Events'], summary: 'Push channel: SSE stream (Accept: text/event-stream) or JSON poll', operationId: 'events',
      description: 'With `Accept: text/event-stream` (or `stream=1`) the response is a Server-Sent Events stream: a `hello` event, replayed durable events, then live events; `: ping` comments every heartbeat. Otherwise a JSON page of pending events. `Last-Event-ID` is honoured as `since`. Because browser EventSource cannot set headers, `?access_token=` is accepted here only.',
      parameters: [query('since', 'Last sequence number processed; everything ≤ since is acknowledged.', int()), query('stream', 'Force SSE', str({ enum: ['1'] })), query('access_token', 'Bearer token for EventSource clients'), { name: 'Last-Event-ID', in: 'header', schema: str() }],
      responses: { 200: { description: 'Events', content: { 'application/json': { schema: ref('EventPoll') }, 'text/event-stream': { schema: str({ description: 'SSE frames: `id: <seq>` / `event: <type>` / `data: <EventEnvelope JSON>`' }) } } }, ...std(401) } } },
    '/events/ack': { post: { tags: ['Events'], summary: 'Acknowledge durable events up to a sequence number', operationId: 'ackEvents',
      requestBody: body(obj({ seq: int() }, { required: ['seq'] })), responses: { 200: json(obj({ acked: int(), pending: int(), cursor: int() })), ...std(400, 401) } } },

    '/prompts': { get: { tags: ['Prompts'], summary: 'Open prompts addressed to this device', operationId: 'listPrompts', ...scopeDoc('interact'), responses: { 200: json(obj({ prompts: arr(ref('Prompt')) })), ...std(401, 403) } } },
    '/prompts/{id}': { parameters: [pathParam('id', 'Prompt id.')], get: { tags: ['Prompts'], summary: 'One prompt (device-tailored view)', operationId: 'getPrompt', ...scopeDoc('interact'), responses: { 200: json(obj({ prompt: ref('Prompt') })), ...std(401, 403, 404) } } },
    '/prompts/{id}/select': { parameters: [pathParam('id', 'Prompt id.')], post: { tags: ['Prompts'], summary: 'Select a choice (option → 200 outcome; free-form → 202 pending)', operationId: 'selectChoice', ...scopeDoc('interact'),
      requestBody: multipart(ref('SelectRequest'), 'JSON, or multipart with a `payload` JSON field plus an `audio`/`image`/`file` part. Multipart `payload` is a JSON string.'),
      responses: { 200: json(ref('SelectResponse'), 'Outcome ready or dismissed'), 202: json(ref('SelectResponse'), 'Pending — outcome arrives as `prompt.outcome` or via GET'), ...std(400, 401, 403, 404, 409, 413, 415) } } },
    '/prompts/{id}/confirm': { parameters: [pathParam('id', 'Prompt id.')], post: { tags: ['Prompts'], summary: 'Confirm the outcome (runs its action under this device scopes) or go back', operationId: 'confirmPrompt', ...scopeDoc('interact (+ command:<action> to confirm an action)'),
      requestBody: body(ref('ConfirmRequest')), responses: { 200: json(ref('ConfirmResponse')), ...std(400, 401, 403, 404, 409, 500) } } },
    '/messages': { post: { tags: ['Messages'], summary: 'Free-form device → agent message', operationId: 'postMessage', ...scopeDoc('interact'),
      requestBody: body(obj({ type: str({ maxLength: 64 }), payload: any('Any JSON within the event budget'), to: str({ description: 'Device id; omit for every agent device.' }), ext: ext() })),
      responses: { 202: json(obj({ delivered: arr(obj({ deviceId: str(), seq: int() })) })), ...std(401, 403, 404, 413) } } },

    '/media': { post: { tags: ['Media'], summary: 'Upload a photo/audio clip', operationId: 'uploadMedia', ...scopeDoc('media:upload | media:* | agent'),
      requestBody: { required: true, content: { 'multipart/form-data': { schema: obj({ file: str({ format: 'binary' }), meta: str({ description: 'JSON string: `{ w, h, source, ext }`' }) }, { required: ['file'] }) } } },
      responses: { 201: json(obj({ media: ref('Media') })), ...std(400, 401, 403, 413, 415) } } },
    '/media/{id}': { parameters: [pathParam('id', 'Media id.')], get: { tags: ['Media'], summary: 'Media bytes', operationId: 'getMedia', ...scopeDoc('owner | media:* | agent'), responses: { 200: { description: 'Binary with its Content-Type', content: { '*/*': { schema: str({ format: 'binary' }) } } }, ...std(401, 404) } } },
    '/media/{id}/info': { parameters: [pathParam('id', 'Media id.')], get: { tags: ['Media'], summary: 'Media metadata', operationId: 'getMediaInfo', ...scopeDoc('owner | media:* | agent'), responses: { 200: json(obj({ media: ref('Media') })), ...std(401, 404) } } },

    '/artifacts/{id}': { parameters: [pathParam('id', 'Artifact id.')], get: { tags: ['Artifacts'], summary: 'Artifact metadata', operationId: 'getArtifact', ...scopeDoc('artifacts:self | artifacts:* | agent'), responses: { 200: json(obj({ artifact: ref('Artifact') })), ...std(401, 403, 404) } } },
    '/artifacts/{id}/content': { parameters: [pathParam('id', 'Artifact id.')], get: { tags: ['Artifacts'], summary: 'Artifact bytes (`X-Doca-Runtime` header; verify sha256 before executing)', operationId: 'getArtifactContent', ...scopeDoc('artifacts:self | artifacts:* | agent'),
      responses: { 200: { description: 'Binary with its Content-Type', headers: { 'X-Doca-Runtime': { schema: str() }, ETag: { schema: str() } }, content: { '*/*': { schema: str({ format: 'binary' }) } } }, ...std(401, 403, 404) } } },

    '/render/chart': { get: { tags: ['Render'], summary: 'Server-rendered chart of up to 4 metrics (PNG, or SVG for svg-capable devices)', operationId: 'renderChart', ...scopeDoc('read:<surface of each metric>'),
      parameters: [query('metrics', 'Comma-separated metric ids (≤ 4)'), query('w', 'Width px (defaults to screen)', int()), query('h', 'Height px', int()), query('rangeSec', 'History window, default 3600', int()), query('theme', 'dark | light', str({ enum: ['dark', 'light'] })), query('title', 'Chart title'), query('unit', 'Axis unit label'), query('labels', 'Comma-separated series labels'), query('thresholds', 'JSON array of `{ level, gte }`'), query('min', 'Y min', num()), query('max', 'Y max', num()), query('round', 'Round corners', str({ enum: ['1'] })), query('format', '`svg` (svg-capable devices only)', str({ enum: ['svg'] }))],
      responses: { 200: { description: 'image/png (or image/svg+xml)', content: { 'image/png': { schema: str({ format: 'binary' }) }, 'image/svg+xml': { schema: str() } } }, ...std(400, 401, 403, 413) } } },
    '/render/figure/{id}': { parameters: [pathParam('id', 'Figure id from a `figure` block.')], get: { tags: ['Render'], summary: 'Figure poster (frames=1) or horizontal sprite sheet (frames=N)', operationId: 'renderFigure',
      parameters: [query('w', 'Frame width px', int()), query('h', 'Frame height px', int()), query('frames', '1–16', int({ minimum: 1, maximum: 16 })), query('format', '`svg` (svg-capable devices only)', str({ enum: ['svg'] }))],
      responses: { 200: { description: 'image/png (or image/svg+xml)', headers: { 'X-Doca-Frames': { schema: int() }, 'X-Doca-Duration-Ms': { schema: int() } }, content: { 'image/png': { schema: str({ format: 'binary' }) }, 'image/svg+xml': { schema: str() } } }, ...std(401, 404, 413) } } },

    // ── Agent-facing ──
    '/agent/devices': { get: { tags: ['Agent'], summary: 'All devices with their effective profiles', operationId: 'agentListDevices', ...scopeDoc('agent'),
      responses: { 200: json(obj({ devices: arr({ allOf: [ref('Device'), obj({ online: bool(), pending: int(), profile: ref('Profile') })] }) })), ...std(401, 403) } } },
    '/agent/prompts': {
      post: { tags: ['Agent'], summary: 'Raise a prompt (fan-out to target devices, tailored per device)', operationId: 'agentCreatePrompt', ...scopeDoc('agent'), requestBody: body(ref('PromptCreate')),
        responses: { 201: json(obj({ prompt: ref('AgentPrompt'), created: bool({ const: true }) }), 'Created'), 200: json(obj({ prompt: ref('AgentPrompt'), created: bool({ const: false }) }), 'Existing prompt with the same `id`'), ...std(400, 401, 403, 413) } },
      get: { tags: ['Agent'], summary: 'List prompts raised by this agent', operationId: 'agentListPrompts', ...scopeDoc('agent'), parameters: [query('state', 'Filter by state', str({ enum: ['open', 'confirmed', 'cancelled', 'expired'] }))], responses: { 200: json(obj({ prompts: arr(ref('AgentPrompt')) })), ...std(401, 403) } },
    },
    '/agent/prompts/{id}': { parameters: [pathParam('id', 'Prompt id.')],
      get: { tags: ['Agent'], summary: 'Prompt with all selections', operationId: 'agentGetPrompt', ...scopeDoc('agent'), responses: { 200: json(obj({ prompt: ref('AgentPrompt') })), ...std(401, 403, 404) } },
      delete: { tags: ['Agent'], summary: 'Cancel a prompt (devices get `prompt.closed`)', operationId: 'agentCancelPrompt', ...scopeDoc('agent'), responses: { 200: json(obj({ prompt: ref('AgentPrompt') })), ...std(401, 403, 404, 409) } } },
    '/agent/prompts/{id}/outcome': { parameters: [pathParam('id', 'Prompt id.')], post: { tags: ['Agent'], summary: 'Resolve a pending free-form selection (`resolver: "agent"`)', operationId: 'agentPostOutcome', ...scopeDoc('agent'),
      requestBody: body(obj({ selectionId: str(), outcome: ref('Outcome') }, { required: ['selectionId', 'outcome'] })), responses: { 200: json(obj({ outcome: ref('Outcome') })), ...std(400, 401, 403, 404, 409) } } },
    '/agent/alerts': { post: { tags: ['Agent'], summary: 'One-way durable alert to devices', operationId: 'agentPostAlert', ...scopeDoc('agent'),
      requestBody: body(obj({ title: str({ maxLength: 120 }), body: arr(ref('Block')), priority: str({ enum: prompts.PRIORITIES }), targets: arr(str()), ttlSec: int(), haptic: bool(), ext: ext() }, { required: ['title'] })),
      responses: { 202: json(obj({ alertId: str(), delivered: arr(obj({ deviceId: str(), seq: int() })) })), ...std(400, 401, 403) } } },
    '/agent/messages': { post: { tags: ['Agent'], summary: 'Free-form agent → device message', operationId: 'agentPostMessage', ...scopeDoc('agent'),
      requestBody: body(obj({ type: str({ maxLength: 64 }), payload: any('Any JSON within the event budget'), targets: arr(str()), ttlSec: int(), ext: ext() })),
      responses: { 202: json(obj({ delivered: arr(obj({ deviceId: str(), seq: int() })) })), ...std(401, 403, 413) } } },
    '/agent/sensors/requests': { post: { tags: ['Agent'], summary: 'Ask a device for sensor readings for a bounded time', operationId: 'agentRequestSensors', ...scopeDoc('agent'),
      requestBody: body(obj({ deviceId: str(), sensors: arr(ref('SensorSpec')), reason: str(), ext: ext() }, { required: ['deviceId', 'sensors'] })),
      responses: { 201: json(obj({ request: ref('SensorRequest'), rejected: arr(obj({ id: str(), reason: str({ enum: ['not_declared', 'not_allowed_by_profile'] }) })) })), ...std(400, 401, 403, 404, 409) } } },
    '/agent/sensors/requests/{id}': { parameters: [pathParam('id', 'Sensor request id.')],
      get: { tags: ['Agent'], summary: 'Request status and recent samples', operationId: 'agentGetSensorRequest', ...scopeDoc('agent'), parameters: [query('limit', 'Max samples, default 200', int())], responses: { 200: json(obj({ request: ref('SensorRequest'), samples: arr(ref('Sample')) })), ...std(401, 403, 404) } },
      delete: { tags: ['Agent'], summary: 'Stop a request early (device gets `sensor.stop`)', operationId: 'agentStopSensorRequest', ...scopeDoc('agent'), responses: { 200: json(obj({ request: ref('SensorRequest') })), ...std(401, 403, 404) } } },
    '/agent/artifacts': {
      post: { tags: ['Agent'], summary: 'Store an artifact (code or data for devices)', operationId: 'agentCreateArtifact', ...scopeDoc('agent'), requestBody: body(ref('ArtifactCreate')), responses: { 201: json(obj({ artifact: ref('Artifact') })), ...std(400, 401, 403, 413) } },
      get: { tags: ['Agent'], summary: 'List artifacts', operationId: 'agentListArtifacts', ...scopeDoc('agent'), responses: { 200: json(obj({ artifacts: arr(ref('Artifact')) })), ...std(401, 403) } },
    },
    '/agent/artifacts/{id}': { parameters: [pathParam('id', 'Artifact id.')], delete: { tags: ['Agent'], summary: 'Delete an artifact', operationId: 'agentDeleteArtifact', ...scopeDoc('agent'), responses: { 200: json(obj({ removed: bool() })), ...std(401, 403) } } },
    '/agent/artifacts/{id}/deliver': { parameters: [pathParam('id', 'Artifact id.')], post: { tags: ['Agent'], summary: 'Push an artifact to devices (gated on their `caps.exec`)', operationId: 'agentDeliverArtifact', ...scopeDoc('agent'),
      requestBody: body(obj({ targets: arr(str()), inline: bool({ description: 'Include the content in the event when it fits the budget.' }), message: str(), ext: ext() }), { required: false }),
      responses: { 202: json(obj({ report: arr(obj({ deviceId: str(), delivered: bool(), seq: int(), reason: str({ enum: ['runtime_unsupported'] }), exec: arr(str()) })) })), ...std(401, 403, 404) } } },
  };
}

// ─── Document ───────────────────────────────────────────────────────────────

function build() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Doca client API',
      version: L.PROTOCOL_VERSION,
      summary: 'Device-agnostic API for thin clients (watches, phones, glasses, kiosks, headless scripts) and agents on the tailnet.',
      description: [
        'Machine-readable companion to `PROTOCOL.md`, which remains the normative specification.',
        'Every operation carries `x-scope` — the token scope(s) it requires — and the `x-events` extension lists every push event type with its payload schema.',
        'Clients **must ignore unknown fields, event types, block types and choice types**; additive changes do not bump the major version.',
        `Generated by the running server (v${serverVersion}); fetch the live copy from \`GET /api/v1/openapi.json\`.`,
      ].join('\n\n'),
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: 'https://{host}:{port}/api/v1', variables: { host: { default: 'doca.tailnet.ts.net', description: 'Tailscale name or IP of the host (no public ingress).' }, port: { default: '4242' } } }],
    tags: [
      { name: 'Discovery', description: 'Unauthenticated discovery and per-token capability discovery.' },
      { name: 'Devices', description: 'Pairing, token issue/rotation/revocation, device records and caps.' },
      { name: 'Profiles', description: 'Server-side per-device configuration (what to show, how often, which sensors are allowed).' },
      { name: 'Variables', description: 'Free-form per-device key/value document for unforeseen state.' },
      { name: 'Sensors', description: 'Device-side sensor reporting.' },
      { name: 'Surfaces', description: 'Typed platform state: metrics and lists with thresholds.' },
      { name: 'Commands', description: 'Actions and long-running jobs.' },
      { name: 'Events', description: 'Push channel (SSE or JSON poll) and acknowledgements.' },
      { name: 'Prompts', description: 'The interaction protocol: prompt → select → outcome → confirm.' },
      { name: 'Messages', description: 'Free-form device → agent messages.' },
      { name: 'Media', description: 'Uploads (photos, audio) referenced by id.' },
      { name: 'Artifacts', description: 'Code/data shipped by agents to devices.' },
      { name: 'Render', description: 'Server-rendered charts and figures for devices without an SVG engine.' },
      { name: 'Agent', description: 'Agent-facing API (scope `agent`): raise prompts and alerts, resolve selections, request sensors, ship artifacts.' },
    ],
    security: [{ bearerToken: [] }],
    paths: paths(),
    components: {
      securitySchemes: {
        bearerToken: { type: 'http', scheme: 'bearer', description: '`Authorization: Bearer doca_<deviceId>.<secret>`. `GET /events` additionally accepts `?access_token=` for EventSource clients.' },
      },
      schemas: schemas(),
    },
    'x-scopes': { families: FAMILIES, presets: PRESETS },
    'x-events': events(),
    'x-limits': { ...L },
    'x-sse': {
      heartbeatSec: L.HEARTBEAT_SEC, retryMs: 3000,
      frames: { hello: obj({ deviceId: str(), cursor: int(), since: int(), replay: int(), resync: bool(), heartbeatSec: int(), protocol: str() }), close: obj({ reason: str() }) },
      note: 'Each event frame is `id: <seq>`, `event: <type>`, `data: <EventEnvelope JSON>`. Comments `: ping <ms>` are heartbeats.',
    },
  };
}

let _cache = null;
function document() { return _cache || (_cache = build()); }

module.exports = { build, document };
