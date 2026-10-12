'use strict';

/**
 * Which vision model reads a picture now (asked 2026-10-12: "a decent smaller model just for image input and text
 * output … if the 27 billion parameter model is not warm yet so it's quicker"). The hive's vision model is
 * `vision.provider` / `vision.model`; a quick one, `vision.quickProvider` / `vision.quickModel`, answers when
 * `vision.quickWhen` says: `cold` — the main model's own server says it is not in memory (a llama.cpp router's
 * unloaded or sleeping model, a model Ollama has not loaded) — `always`, or `never`. A server that says nothing about
 * memory (a cloud provider, any OpenAI-compatible server) counts as warm: only what a server says decides. When the
 * quick model answers and `vision.warmMain` is on, the main model is asked for one token in the background, so the next
 * look is the main one's. Both are settings, so any model replaces either; nothing here names one.
 */
const sc = () => require('../settings-schema');
const LOADED = new Set(['loaded', 'working']);
const COLD = new Set(['unloaded', 'sleeping', 'loading']);
const SEEN_MS = 5000;
let _seen = { key: '', at: 0, cold: false };
let _waking = null;

/** Whether the main model is known to be out of memory on its own server (true), or warm / not said (false). */
async function cold(provider, model, probe = require('../model-servers').probe) {
  const key = `${provider}/${model}`;
  if (_seen.key === key && Date.now() - _seen.at < SEEN_MS) return _seen.cold;
  let isCold = false;
  try {
    const ep = require('../harness/providers').endpoint(provider);
    const r = await probe(ep);
    if (r?.answering && (r.kind === 'llama.cpp router' || r.kind === 'Ollama')) {
      const m = (r.models || []).find(x => x.id === model || x.id === `${model}:latest`);
      isCold = r.kind === 'Ollama' ? !m : !m || COLD.has(m.state) || !LOADED.has(m.state);
    }
  } catch { /* a server that cannot be asked is not judged cold */ }
  _seen = { key, at: Date.now(), cold: isCold };
  return isCold;
}

/** One token from the main model, in the background, so its server loads it. Never twice at once. */
function wake(provider, model) {
  if (_waking) return _waking;
  const ep = require('../harness/providers').endpoint(provider);
  _waking = fetch(`${ep.baseUrl}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(300000),
    headers: { 'Content-Type': 'application/json', ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}) },
    body: JSON.stringify({ model, stream: false, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }) })
    .then(r => r.body?.cancel?.()).catch(() => {}).finally(() => { _waking = null; _seen.at = 0; });
  return _waking;
}

/**
 * The model to ask: `{provider, model, quick, why}` — `quick` when the quick model was chosen, `why` saying so in a
 * line the reader's answer can carry. `s` is vision's settings (index.js settings()); the quick keys are read here.
 */
async function pick(s = {}, { probe } = {}) {
  const main = { provider: s.provider ?? sc().value('vision.provider'), model: s.model ?? sc().value('vision.model') };
  const quick = { provider: sc().value('vision.quickProvider') || main.provider, model: sc().value('vision.quickModel') };
  const when = sc().value('vision.quickWhen');
  if (!quick.model || when === 'never' || (quick.provider === main.provider && quick.model === main.model)) return { ...main, quick: false };
  if (!main.model || when === 'always') return { ...quick, quick: true, why: main.model ? 'the quick vision model, as set' : 'the quick vision model (no main one is set)' };
  if (!(await cold(main.provider, main.model, probe))) return { ...main, quick: false };
  if (sc().value('vision.warmMain') !== false) wake(main.provider, main.model);
  return { ...quick, quick: true, why: `the quick vision model, while ${main.model} was not loaded` };
}

module.exports = { pick, cold, wake, _reset: () => { _seen = { key: '', at: 0, cold: false }; _waking = null; } };
