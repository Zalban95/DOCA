'use strict';

/**
 * Long-running command jobs. A job wraps an existing Express handler (JSON
 * or SSE-streaming) through a fake req/res pair, so the client layer reuses
 * the platform's command implementations without duplicating them.
 *
 * Progress is pushed to the invoking device as ephemeral `job.progress`
 * events; completion as a durable `job.done` event. The job record is also
 * readable at GET /api/v1/jobs/:id for clients without a stream.
 */
const crypto = require('crypto');
const bus = require('./bus');

const _jobs = new Map();
const MAX_JOBS = 200;

function newJob(commandId, deviceId, params) {
  const job = {
    id: `job_${crypto.randomBytes(6).toString('hex')}`,
    commandId, deviceId, params,
    status: 'running', startedAt: new Date().toISOString(), endedAt: null,
    output: [], result: null, error: null,
  };
  _jobs.set(job.id, job);
  if (_jobs.size > MAX_JOBS) _jobs.delete(_jobs.keys().next().value);
  return job;
}

function get(id) { return _jobs.get(id) || null; }

function publicView(job) {
  if (!job) return null;
  const { output, ...rest } = job;
  return { ...rest, outputTail: output.slice(-20) };
}

/**
 * Invoke an Express-style handler with a synthetic request. Resolves with
 * { status, body, stream } where `stream` is the list of parsed SSE chunks
 * (for streaming handlers) and `body` the JSON body (for JSON handlers).
 * `onChunk` receives each streamed chunk as it arrives.
 */
function invokeHandler(handler, { body = {}, params = {}, query = {} } = {}, onChunk) {
  return new Promise((resolve, reject) => {
    let status = 200, done = false;
    const stream = [];
    const closeHandlers = [];
    const finish = (out) => { if (done) return; done = true; resolve({ status, ...out }); };
    const req = { body, params, query, headers: {}, on: (ev, fn) => { if (ev === 'close') closeHandlers.push(fn); } };
    const res = {
      setHeader() {}, flushHeaders() {}, writeHead() {},
      on: (ev, fn) => { if (ev === 'close') closeHandlers.push(fn); },
      status(c) { status = c; return res; },
      json(obj) { finish({ body: obj, stream }); return res; },
      send(obj) { finish({ body: obj, stream }); return res; },
      write(chunk) {
        for (const line of String(chunk).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          let parsed; try { parsed = JSON.parse(line.slice(6)); } catch { parsed = line.slice(6); }
          stream.push(parsed);
          if (onChunk) { try { onChunk(parsed); } catch {} }
        }
        return true;
      },
      end() { finish({ body: null, stream }); },
    };
    try {
      const r = handler(req, res);
      if (r && typeof r.catch === 'function') r.catch(reject);
    } catch (e) { reject(e); }
  });
}

/** Text of an SSE chunk from the various shapes existing handlers emit. */
function chunkText(c) {
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') return c.status || c.text || c.message || JSON.stringify(c);
  return String(c);
}

/** Did a streamed handler end successfully? (Heuristics over existing conventions.) */
function streamOk(stream) {
  const last = stream[stream.length - 1];
  if (last && typeof last === 'object' && 'done' in last) return !!last.ok && !last.error;
  const texts = stream.map(chunkText);
  if (texts.some(t => /^\[exit (\d+)\]$/.test(t.trim()))) return texts.some(t => /^\[exit 0\]$/.test(t.trim()));
  return !texts.some(t => /^ERROR:|^\[error/i.test(t.trim()));
}

/**
 * Run a handler as a background job for `deviceId`. Returns the job record
 * immediately; progress and completion flow over the push channel.
 */
function runAsJob(commandId, deviceId, handler, reqShape, params) {
  const job = newJob(commandId, deviceId, params);
  const onChunk = (c) => {
    const text = chunkText(c);
    job.output.push(text);
    if (job.output.length > 500) job.output.splice(0, job.output.length - 500);
    try { bus.publish(deviceId, 'job.progress', { jobId: job.id, commandId, text: text.slice(0, 2000) }); } catch {}
  };
  invokeHandler(handler, reqShape, onChunk).then(({ status, body, stream }) => {
    const ok = body ? (status < 400 && !body.error) : streamOk(stream);
    job.status = ok ? 'done' : 'failed';
    job.endedAt = new Date().toISOString();
    job.result = body || null;
    if (!ok) job.error = (body && body.error) || job.output.slice(-3).join('').trim().slice(0, 500) || 'command failed';
    bus.publish(deviceId, 'job.done', { jobId: job.id, commandId, status: job.status, error: job.error, result: job.result, outputTail: job.output.slice(-10) });
  }).catch(e => {
    job.status = 'failed'; job.endedAt = new Date().toISOString(); job.error = e.message;
    bus.publish(deviceId, 'job.done', { jobId: job.id, commandId, status: 'failed', error: e.message });
  });
  return job;
}

function _reset() { _jobs.clear(); }

module.exports = { newJob, get, publicView, invokeHandler, runAsJob, _reset };
