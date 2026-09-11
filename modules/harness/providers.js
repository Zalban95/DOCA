'use strict';

/**
 * Where the built-in harness gets its tokens from.
 *
 * Every provider is talked to through the same OpenAI-compatible
 * `/chat/completions` shape, including the ones whose native API differs —
 * Anthropic and Google both publish a compatible endpoint, so one code path
 * covers all of them and local runtimes (Ollama, llama.cpp, vLLM) as well.
 *
 * Keys are not stored here. A provider is either declared in openclaw.json
 * (Settings → API Keys writes there, and the llama.cpp manager registers its
 * instances there) or picked up from the environment variable the vendor
 * documents.
 */
const fs = require('fs');

const { CONFIG_PATH } = require('../paths');
const { loadModelsPrefs, resolveEnvVars } = require('../utils');

/** True for an endpoint on this machine or a private network — no key expected. */
const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|172\.|192\.168\.|10\.)/;

function isLocalUrl(url) {
  return LOCAL_URL.test(url || '');
}

/**
 * Endpoints we know, so a key alone (or nothing at all, locally) is enough.
 *
 * The local runtimes are listed at the port each one ships with. Running one
 * somewhere else does not need a code change: declare it in Settings → API Keys
 * with the same id and the base URL saved there wins over the default below.
 */
const PRESETS = {
  llamacpp:   { label: 'llama.cpp (local)', baseUrl: 'http://127.0.0.1:8080/v1' },
  vllm:       { label: 'vLLM (local)',      baseUrl: 'http://127.0.0.1:8000/v1' },
  lmstudio:   { label: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1' },
  openai:     { label: 'OpenAI',        baseUrl: 'https://api.openai.com/v1',                            env: 'OPENAI_API_KEY' },
  anthropic:  { label: 'Anthropic',     baseUrl: 'https://api.anthropic.com/v1',                         env: 'ANTHROPIC_API_KEY' },
  google:     { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY' },
  groq:       { label: 'Groq',          baseUrl: 'https://api.groq.com/openai/v1',                       env: 'GROQ_API_KEY' },
  openrouter: { label: 'OpenRouter',    baseUrl: 'https://openrouter.ai/api/v1',                         env: 'OPENROUTER_API_KEY' },
  mistral:    { label: 'Mistral',       baseUrl: 'https://api.mistral.ai/v1',                            env: 'MISTRAL_API_KEY' },
  deepseek:   { label: 'DeepSeek',      baseUrl: 'https://api.deepseek.com/v1',                          env: 'DEEPSEEK_API_KEY' },
  xai:        { label: 'xAI Grok',      baseUrl: 'https://api.x.ai/v1',                                  env: 'XAI_API_KEY' },
  together:   { label: 'Together',      baseUrl: 'https://api.together.xyz/v1',                          env: 'TOGETHER_API_KEY' },
  cerebras:   { label: 'Cerebras',      baseUrl: 'https://api.cerebras.ai/v1',                           env: 'CEREBRAS_API_KEY' },
};

const DEFAULT_SYSTEM_PROMPT = `You are the DOCA harness: the resident agent of a DOCA control panel, running on the machine you are managing.

You have real tools. Use them instead of guessing or asking the user to run things for you — read files before editing them, and check the system's actual state before describing it.

You have a durable memory. When you learn something that will still matter in a later conversation (how this machine is set up, paths, ports, hardware, the user's preferences and standing instructions), write it down with memory_write. Search it with memory_search when a question depends on something you were told before. Do not store secrets, and do not store one-off details that will be stale tomorrow.

Be concise and concrete. Say what you did and what you found, not what you are about to do.`;

/** The parameter set the ⚙ panel edits, and the values a fresh install gets. */
function defaultParams() {
  return {
    provider:       'ollama',
    model:          '',
    temperature:    0.7,
    topP:           1,
    maxTokens:      2048,
    systemPrompt:   DEFAULT_SYSTEM_PROMPT,
    maxSteps:       8,      // tool-call rounds per turn before we stop
    historyTurns:   24,     // messages kept verbatim in the window
    memoryLimit:    24,     // memory entries injected into the system prompt
    summarizeAfter: 40,     // messages before older ones fold into a summary
    disabledTools:  [],
  };
}

/** Providers declared in openclaw.json (Settings → API Keys, llama.cpp). */
function declared() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return cfg?.models?.providers || {};
  } catch { return {}; }
}

function ollamaBase() {
  return (loadModelsPrefs().ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

/**
 * Turn a provider id into something callable.
 * @param {string} id
 * @returns {{ id: string, label: string, baseUrl: string, apiKey: string, local: boolean }}
 */
function endpoint(id) {
  if (!id || id === 'ollama')
    return { id: 'ollama', label: 'Ollama (local)', baseUrl: `${ollamaBase()}/v1`, apiKey: '', local: true };

  const cfg    = declared()[id] || null;
  const preset = PRESETS[id]    || null;
  const baseUrl = (resolveEnvVars(cfg?.baseUrl) || preset?.baseUrl || '').replace(/\/+$/, '');
  const apiKey  = resolveEnvVars(cfg?.apiKey || '') || (preset?.env ? process.env[preset.env] || '' : '');

  if (!baseUrl)
    throw Object.assign(new Error(
      `Provider "${id}" has no base URL — add it in Settings → API Keys`), { status: 400 });

  return {
    id,
    label: preset?.label || id,
    baseUrl,
    apiKey,
    local: isLocalUrl(baseUrl),
  };
}

/** Everything the provider dropdown should offer, with key state. */
function list() {
  const cfg = declared();
  const ids = new Set(['ollama', ...Object.keys(PRESETS), ...Object.keys(cfg)]);
  return [...ids].map(id => {
    try {
      const e = endpoint(id);
      return { id, label: e.label, baseUrl: e.baseUrl, local: e.local, hasKey: !!e.apiKey || e.local };
    } catch {
      return { id, label: PRESETS[id]?.label || id, baseUrl: '', local: false, hasKey: false };
    }
  }).sort((a, b) => Number(b.hasKey) - Number(a.hasKey) || a.id.localeCompare(b.id));
}

/**
 * Models for one provider: what the provider advertises, falling back to what
 * openclaw.json declares when the endpoint cannot be reached (offline, no key).
 * @returns {Promise<{ models: string[], error: string|null }>}
 */
async function models(id) {
  const declaredModels = (declared()[id]?.models || [])
    .map(m => (typeof m === 'string' ? m : m.id || m.name))
    .filter(Boolean);

  let e;
  try { e = endpoint(id); }
  catch (err) { return { models: declaredModels, error: err.message }; }

  // Ollama's own endpoint lists pulled models; /v1/models mirrors it but the
  // native one is what the Models tab shows, so stay consistent with it.
  const url     = e.id === 'ollama' ? `${ollamaBase()}/api/tags` : `${e.baseUrl}/models`;
  const headers = e.apiKey ? { Authorization: `Bearer ${e.apiKey}` } : {};

  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body  = await r.json();
    const found = e.id === 'ollama'
      ? (body.models || []).map(m => m.name)
      : (body.data || body.models || []).map(m => m.id || m.name).filter(Boolean);
    const merged = [...new Set([...found, ...declaredModels])].sort();
    return { models: merged, error: null };
  } catch (err) {
    return { models: declaredModels, error: `${e.baseUrl}: ${err.message}` };
  }
}

module.exports = { PRESETS, DEFAULT_SYSTEM_PROMPT, defaultParams, endpoint, isLocalUrl, list, models, ollamaBase };
