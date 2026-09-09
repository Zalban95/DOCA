'use strict';

/**
 * Command registry: the side effects a client may trigger, each mapped onto
 * an existing platform handler. Every command declares a params schema, a
 * scope (`command:<id>`), whether it needs confirmation and whether it is
 * long-running (returns a job instead of a result).
 */
const controls   = require('../controls');
const docker     = require('../docker');
const services   = require('../services');
const llamacpp   = require('../models-llamacpp');
const skills     = require('../skills');
const snapshots  = require('../snapshots');
const update     = require('../update');
const jobs       = require('./jobs');
const { ApiError } = require('./errors');

const ID = { type: 'string', required: true, maxLength: 128 };

const COMMANDS = {
  'compose.start':   { title: 'Start stack',   confirm: false, longRunning: false, params: {}, run: () => jobs.invokeHandler(controls.handleAction, { body: { action: 'start' } }) },
  'compose.stop':    { title: 'Stop stack',    confirm: true,  longRunning: false, params: {}, run: () => jobs.invokeHandler(controls.handleAction, { body: { action: 'stop' } }) },
  'compose.restart': { title: 'Restart stack', confirm: true,  longRunning: false, params: {}, run: () => jobs.invokeHandler(controls.handleAction, { body: { action: 'restart' } }) },

  'docker.container.start':   { title: 'Start container',   confirm: false, longRunning: false, params: { id: ID },
    run: p => jobs.invokeHandler(docker.handleContainerAction, { params: { id: p.id }, body: { action: 'start' } }) },
  'docker.container.stop':    { title: 'Stop container',    confirm: true,  longRunning: false, params: { id: ID },
    run: p => jobs.invokeHandler(docker.handleContainerAction, { params: { id: p.id }, body: { action: 'stop' } }) },
  'docker.container.restart': { title: 'Restart container', confirm: true,  longRunning: false, params: { id: ID },
    run: p => jobs.invokeHandler(docker.handleContainerAction, { params: { id: p.id }, body: { action: 'restart' } }) },

  'services.start': { title: 'Start inference service', confirm: false, longRunning: true,
    params: { id: { ...ID, enum: services.INFERENCE_SERVICES.map(s => s.id) }, gpu: { type: 'string', enum: ['all', '0', '1', ''] }, modelId: { type: 'string', maxLength: 200 } },
    handler: services.handleStart, shape: p => ({ body: { id: p.id, gpu: p.gpu ?? 'all', modelId: p.modelId || '' } }) },
  'services.stop':  { title: 'Stop inference service', confirm: true, longRunning: false,
    params: { id: { ...ID, enum: services.INFERENCE_SERVICES.map(s => s.id) } },
    run: p => jobs.invokeHandler(services.handleStop, { body: { id: p.id } }) },

  'llamacpp.start':   { title: 'Start llama.cpp server',   confirm: false, longRunning: true,  params: { id: ID }, handler: llamacpp.handleStart, shape: p => ({ body: { id: p.id } }) },
  'llamacpp.stop':    { title: 'Stop llama.cpp server',    confirm: true,  longRunning: false, params: { id: ID }, run: p => jobs.invokeHandler(llamacpp.handleStop, { body: { id: p.id } }) },
  'llamacpp.restart': { title: 'Restart llama.cpp server', confirm: true,  longRunning: true,  params: { id: ID }, handler: llamacpp.handleRestart, shape: p => ({ body: { id: p.id } }) },

  'skills.toggle': { title: 'Enable/disable skill', confirm: false, longRunning: false, params: { name: ID }, run: p => jobs.invokeHandler(skills.handleToggle, { params: { name: p.name } }) },

  'snapshots.create': { title: 'Create snapshot', confirm: true, longRunning: true, params: { label: { type: 'string', maxLength: 64 } }, handler: snapshots.handleCreate, shape: p => ({ body: { label: p.label } }) },

  'panel.restart': { title: 'Restart dashboard server', confirm: true, longRunning: false, params: {}, run: () => jobs.invokeHandler(update.handleRestart, {}) },
};

function ids() { return Object.keys(COMMANDS); }
function get(id) { return COMMANDS[id] || null; }

/** Public description for capabilities. */
function describe(id) {
  const c = COMMANDS[id];
  if (!c) return null;
  const params = {};
  for (const [k, v] of Object.entries(c.params)) params[k] = { type: v.type, required: !!v.required, enum: v.enum, maxLength: v.maxLength };
  return { id, title: c.title, params, confirm: c.confirm, longRunning: c.longRunning, scope: `command:${id}` };
}

/** Validate and coerce params against the command schema. */
function validateParams(id, params) {
  const c = COMMANDS[id];
  const out = {};
  const p = params && typeof params === 'object' ? params : {};
  for (const [k, spec] of Object.entries(c.params)) {
    const v = p[k];
    if (v === undefined || v === null || v === '') {
      if (spec.required) throw new ApiError(400, 'invalid_params', `Missing required param '${k}'`, { param: k });
      continue;
    }
    if (spec.type === 'string') {
      if (typeof v !== 'string') throw new ApiError(400, 'invalid_params', `Param '${k}' must be a string`, { param: k });
      if (spec.maxLength && v.length > spec.maxLength) throw new ApiError(400, 'invalid_params', `Param '${k}' too long`, { param: k });
      if (spec.enum && !spec.enum.includes(v)) throw new ApiError(400, 'invalid_params', `Param '${k}' must be one of ${spec.enum.join(', ')}`, { param: k });
      if (/[;&|`$\n\r]/.test(v)) throw new ApiError(400, 'invalid_params', `Param '${k}' contains forbidden characters`, { param: k });
    }
    out[k] = v;
  }
  return out;
}

/**
 * Execute a command for a device. Returns
 *   { kind: 'result', status, result }  for short commands
 *   { kind: 'job', job }                for long-running ones
 */
async function execute(id, rawParams, deviceId) {
  const c = COMMANDS[id];
  if (!c) throw new ApiError(404, 'unknown_command', `No command '${id}'`);
  const params = validateParams(id, rawParams);
  if (c.longRunning) {
    const job = jobs.runAsJob(id, deviceId, c.handler, c.shape(params), params);
    return { kind: 'job', job };
  }
  const { status, body } = await c.run(params);
  if (status >= 400 || (body && body.error)) {
    throw new ApiError(status >= 400 ? status : 500, 'command_failed', (body && (body.error || body.stderr)) || 'Command failed', { commandId: id });
  }
  return { kind: 'result', status, result: body };
}

module.exports = { COMMANDS, ids, get, describe, validateParams, execute };
