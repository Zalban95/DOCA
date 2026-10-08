'use strict';

/**
 * A stopped service started when a request needs it (asked 2026-10-08): a voice set to the expressive Qwen3-TTS, the
 * transcriber, or a model on a stopped llama.cpp server. Only one DOCA manages and whose row says "Start when needed"
 * (on by default for what DOCA started before, off otherwise — policy.startsWhenNeeded); starting asks nothing, since it
 * is the person's own configured service and any download was confirmed when it was installed. The person is told:
 * `onStarting` gets "Starting the voice (Qwen3-TTS), a few seconds…", and, when the start fails, why — the request
 * then goes on as it always did (and fails, or falls back, as it always did).
 *
 * `ensure(url)` is cheap for everything else: an address that is not a managed service on this machine returns at once,
 * without asking docker anything. Two requests needing the same service wait on one start.
 */
const _starting = new Map();   // key → Promise<{ ok, why }>
const _failed = new Map();     // key → { at, why }: a start that failed is not tried again on every request
const RETRY_MS = 2 * 60000;

const WHAT = { speech: 'the voice', stt: 'the transcriber', model: 'the model\'s server' };

/** The words for a person: what starts, and what it is for. */
function words(t, role) {
  return `Starting ${WHAT[role] || t.label} (${t.label.replace(/^the llama\.cpp server /, '')}), a few seconds…`;
}

/**
 * Make sure the service at `url` runs. → { state: 'ready' | 'started' | 'starting' | 'failed' | 'off', notice? }
 *   wait: false  starts it and returns 'starting' at once (the panel's speech: it says so, and asks again)
 *   role         speech | stt | model — how the notice names it
 */
async function ensure(url, { wait = true, role = 'model', onStarting = null } = {}) {
  const usage = require('./usage'), targets = require('./targets'), policy = require('./policy');
  let key = null;
  try { key = usage.keyOfUrl(url); } catch { /* not ours */ }
  if (!key || !policy.startsWhenNeeded(key)) return { state: 'off' };
  const t = targets.get(key);
  if (!t) return { state: 'off' };
  if (!_starting.has(key)) {
    if ((await targets.running()).has(key)) return { state: 'ready' };
    const f = _failed.get(key);
    if (f && Date.now() - f.at < RETRY_MS) return { state: 'failed', notice: `${t.label} could not be started a moment ago (${f.why}).` };
    const p = (async () => {
      const r = await targets.start(t);
      if (r.ok) { usage.started(key); _failed.delete(key); } else _failed.set(key, { at: Date.now(), why: r.why || 'it failed' });
      require('./idle').note(t, r, `a request needed it (${WHAT[role] || 'a request'})`, 'start');
      return r;
    })().finally(() => _starting.delete(key));
    _starting.set(key, p);
  }
  const notice = words(t, role);
  try { onStarting?.(notice); } catch { /* a listener gone */ }
  if (!wait) return { state: 'starting', notice, label: t.label };
  const r = await _starting.get(key) || { ok: true };
  if (r.ok) return { state: 'started', notice };
  const failed = `${t.label} could not be started (${r.why || 'it failed'}) — going on without it.`;
  try { onStarting?.(failed); } catch { /* gone */ }
  return { state: 'failed', notice: failed };
}

const starting = key => _starting.has(key);

module.exports = { ensure, starting, words, _reset: () => { _starting.clear(); _failed.clear(); } };
