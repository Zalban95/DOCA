'use strict';

/**
 * GET /api/v1/capabilities — everything one device may see and do, already
 * filtered by its scopes and shaped by its declared capabilities. Clients
 * build their UI from this document and never hard-code surface, metric or
 * command ids.
 */
const pkg      = require('../../package.json');
const bus      = require('./bus');
const devices  = require('./devices');
const surfaces = require('./surfaces');
const commands = require('./commands');
const profiles = require('./profiles');
const prompts  = require('./prompts');
const motion   = require('./motion');
const media    = require('./media');
const scopes   = require('./scopes');
const render   = require('./render');
const { hasScope } = require('./scopes');
const L = require('./limits');

async function build(device) {
  const defs = surfaces.definitions((await require('./sampler').latest(30)).status);
  const readable = Object.values(defs).filter(d => hasScope(device.scopes, `read:${d.id}`)).map(surfaces.describe);
  const runnable = commands.ids().filter(id => hasScope(device.scopes, `command:${id}`)).map(commands.describe);
  const profile = profiles.effective(profiles.get(device.id), device.scopes);
  const openPrompts = hasScope(device.scopes, 'interact') ? prompts.openFor(device).length : 0;

  return {
    protocol: {
      version: L.PROTOCOL_VERSION, minClient: L.PROTOCOL_MIN_CLIENT,
      clientMax: device.caps?.protocol?.max || L.PROTOCOL_VERSION,
      motionVocabulary: motion.MOTION_VOCAB,
      blockTypes: motion.BLOCK_TYPES, choiceTypes: prompts.CHOICE_TYPES, priorities: prompts.PRIORITIES,
      eventTypes: Object.entries(bus.TYPES).map(([type, d]) => ({ type, class: d.cls })),
      metricKinds: surfaces.KINDS, units: surfaces.UNITS, itemStates: surfaces.STATES,
      easings: motion.EASINGS, colorRoles: motion.COLOR_ROLES,
    },
    server: { name: 'doca', version: pkg.version, time: new Date().toISOString() },
    device: devices.publicView(device),
    scopes: { granted: device.scopes, families: scopes.FAMILIES },
    surfaces: readable,
    commands: runnable,
    push: {
      url: '/api/v1/events', ackUrl: '/api/v1/events/ack',
      heartbeatSec: L.HEARTBEAT_SEC, retainedEvents: L.OUTBOX_MAX_EVENTS, retainedHours: L.OUTBOX_MAX_HOURS,
      cursor: bus.cursor(device.id), pending: bus.pendingCount(device.id),
      backoff: { initialMs: 1000, maxMs: 60000, factor: 2, jitter: 0.2 },
    },
    render: {
      formats: ['png'], maxImageBytes: L.IMAGE_BYTES, themes: Object.keys(render.THEMES),
      chartUrl: '/api/v1/render/chart', figureUrl: '/api/v1/render/figure/{figureId}',
      defaults: device.caps?.screen ? { w: Math.min(device.caps.screen.w, 480), h: Math.min(device.caps.screen.h, 480), round: device.caps.screen.shape === 'round' } : { w: 320, h: 160, round: false },
    },
    limits: {
      snapshotBytes: L.SNAPSHOT_BYTES, promptBytes: L.PROMPT_BYTES, eventBytes: L.EVENT_BYTES, imageBytes: L.IMAGE_BYTES,
      mediaBytes: L.MEDIA_BYTES, audioBytes: L.AUDIO_BYTES, audioSec: L.AUDIO_SEC, artifactBytes: L.ARTIFACT_BYTES,
      extBytes: L.EXT_BYTES, varsBytes: L.VARS_BYTES, sparkMaxPoints: L.SPARK_MAX_POINTS, minRefreshSec: L.SAMPLER_MIN_INTERVAL_SEC,
      sensorMaxRateHz: L.SENSOR_MAX_RATE_HZ, sensorMaxDurationSec: L.SENSOR_MAX_DURATION_SEC, sensorBatchMax: L.SENSOR_BATCH_MAX,
    },
    profile: { version: profile.version, etag: profile.etag, url: '/api/v1/devices/me/profile', warnings: profile.warnings },
    vars: { version: device.varsVersion || 0, url: '/api/v1/devices/me/vars' },
    sensors: { declared: device.caps?.sensors || [], allowed: profile.sensors?.allow || [], autoReport: profile.sensors?.autoReport || [], reportUrl: '/api/v1/sensors/samples' },
    media: { uploadUrl: '/api/v1/media', accept: Object.keys(media.ALLOWED) },
    artifacts: { url: '/api/v1/artifacts/{artifactId}', runtimes: device.caps?.exec || [] },
    prompts: { url: '/api/v1/prompts', open: openPrompts, receive: profile.prompts?.receive !== false },
    messages: { url: '/api/v1/messages' },
    deprecations: [],
  };
}

module.exports = { build };
