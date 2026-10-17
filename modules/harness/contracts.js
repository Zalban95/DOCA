'use strict';

/**
 * What a provider's server accepts, as data (TODO.md, "Wanted next: many
 * agents": "One request shape is sent to every provider, and they do not agree
 * on one" — the provider contract).
 *
 * The quirks were literals in the transport: a server that wants
 * `max_completion_tokens`, or that refuses `stream_options`, got the request it
 * refuses, a 400, and then the corrected retry — on every call, for the life of
 * the panel. Each one is now a field of the provider's contract:
 *
 *   tokenField   'max_tokens' | 'max_completion_tokens'   per provider, and per model
 *   streamUsage  true | false   whether `stream_options.include_usage` may be sent
 *   effortField  reasoning_effort | reasoning | thinking | enable_thinking | no_think | none   how it hears a thinking effort (turn/effort.js)
 *   effortOff    minimal | none   the reasoning_effort word that means no thinking
 *   maxOutput    a number   the most completion tokens one reply may ask for, per model — learned from a 400 that names
 *                it (round 1 of the test of 2026-10-16: OpenRouter refused 256000 for a model that takes 131072, and
 *                every mastermind step failed), or read from the server's /models list (context-window.js), never guessed
 *
 * Three layers, the later winning:
 *   1. learned   what a 400-and-retry proved, kept in the data folder (`harness/contracts`),
 *                so the failing round trip is paid once, not per call
 *   2. prefs     `providerContracts.<provider>` — the owner's correction, and the
 *                way to undo a wrong lesson; `models.<model>` inside it for one model
 *   3. nothing is guessed: with no lesson and no override, the request goes as before
 *
 * Learned facts are about this server as it answered, so they carry `at`; a
 * provider that later starts accepting a field keeps being sent the shape it
 * once needed, which costs nothing. `forget()` clears one provider's lessons.
 */
const store = require('../store');
const { loadPrefs } = require('../utils');

const DOC = 'harness/contracts';
const FIELDS = ['tokenField', 'streamUsage', 'effortField', 'effortOff', 'maxOutput'];   // effortField, effortOff: turn/effort.js

const learned = () => store.readJson(DOC, { providers: {} });

/** The merged contract for one provider and model. Empty when nothing is known. */
function forProvider(provider, model) {
  const l = learned().providers[provider] || {};
  const o = (loadPrefs().providerContracts || {})[provider] || {};
  const pick = src => Object.fromEntries(FIELDS.filter(k => src?.[k] !== undefined).map(k => [k, src[k]]));
  return { ...pick(l), ...pick(l.models?.[model]), ...pick(o), ...pick(o.models?.[model]) };
}

/** Record what a retry proved. `perModel` for a fact about one model rather than the server. */
function learn(provider, model, facts, { perModel = false, quiet = false } = {}) {
  if (!provider) return;
  const doc = learned();
  const p = doc.providers[provider] ||= {};
  const was = perModel && model ? p.models?.[model] : p;
  if (quiet && was && Object.entries(facts).every(([k, v]) => was[k] === v)) return;   // nothing new: no write
  const at = new Date().toISOString();
  if (perModel && model) Object.assign((p.models ||= {})[model] ||= {}, facts, { at });
  else Object.assign(p, facts, { at });
  store.writeJson(DOC, doc);
  console.warn(`[harness] learned about ${provider}${perModel && model ? ` / ${model}` : ''}: ${JSON.stringify(facts)} — sent that way from now on (harness/contracts.js).`);
}

function forget(provider) {
  const doc = learned();
  delete doc.providers[provider];
  store.writeJson(DOC, doc);
}

/** The request body reshaped to the contract: the token field renamed and held to the model's maximum, usage frames left out. */
function shape(body, c) {
  let out = capOutput(body, c.maxOutput);
  if (c.tokenField === 'max_completion_tokens' && out.max_tokens !== undefined) {
    const { max_tokens, ...rest } = out;
    out = { ...rest, max_completion_tokens: max_tokens };
  }
  if (c.streamUsage === false && out.stream_options) {
    const { stream_options, ...rest } = out;
    out = rest;
  }
  return out;
}

/** The body with its reply cap (either token field) held to `max`; unchanged when there is no cap or it fits. */
function capOutput(body, max) {
  const n = Number(max);
  if (!(n > 0)) return body;
  for (const f of ['max_tokens', 'max_completion_tokens'])
    if (Number(body[f]) > n) return { ...body, [f]: Math.floor(n) };
  return body;
}

/**
 * The most completion tokens a provider's refusal says the model takes, or null. Read defensively, only from wordings
 * that name output/completion tokens and a number (a context-length refusal is a different limit):
 *   OpenAI, OpenRouter  "This model supports at most 131072 completion tokens"
 *   Anthropic           "max_tokens: 256000 > 64000, which is the maximum allowed number of output tokens for …"
 *   DeepSeek            "the valid range of max_tokens is [1, 8192]"
 *   Groq, vLLM, others  "`max_tokens` must be less than or equal to `8192`", "max_tokens must be at most 8192",
 *                       "maximum (number of) output tokens is 8192"
 */
function maxOutputFrom(detail) {
  const s = String(detail || '').slice(0, 4000).replace(/\\?["`']/g, '').replace(/[`'"]/g, '');
  const pats = [
    /supports at most (\d+) (?:completion|output) tokens/i,
    /\d+\s*>\s*(\d+),? which is the maximum (?:allowed )?(?:number of )?(?:output|completion) tokens/i,
    /valid range of max_(?:completion_)?tokens is \[\s*\d+\s*,\s*(\d+)\s*\]/i,
    /max_(?:completion_|output_)?tokens\s*(?:must|should) be (?:less than or equal to|at most|<=|no (?:more|greater) than)\s*(\d+)/i,
    /max(?:imum)? (?:number of )?(?:output|completion) tokens (?:is|allowed is|of|=|:)\s*(\d+)/i,
  ];
  for (const re of pats) {
    const m = s.match(re);
    const n = m && Number(m[1]);
    if (n > 0 && n < 1e8) return n;
  }
  return null;
}

/**
 * The most reply tokens a credit refusal says can be paid for, or null — OpenRouter's 402: "This request requires more
 * credits, or fewer max_tokens. You requested up to 128000 tokens, but can only afford 9070." Never learned: credit moves.
 */
function affordableFrom(detail) {
  const m = String(detail || '').slice(0, 4000).match(/can only afford (\d+)/i);
  const n = m && Number(m[1]);
  return n > 0 && n < 1e8 ? n : null;
}

/** The reply cap a body asks for (either token field), or 0. */
function outputOf(body) { return Number(body?.max_tokens ?? body?.max_completion_tokens) || 0; }

function all() { return learned().providers; }

module.exports = { forProvider, learn, forget, shape, capOutput, maxOutputFrom, affordableFrom, outputOf, all, FIELDS };
