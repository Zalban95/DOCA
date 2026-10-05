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
 *   effortField  reasoning_effort | reasoning | thinking | enable_thinking | none   how it hears a thinking effort (turn/effort.js)
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
const FIELDS = ['tokenField', 'streamUsage', 'effortField'];   // effortField: turn/effort.js

const learned = () => store.readJson(DOC, { providers: {} });

/** The merged contract for one provider and model. Empty when nothing is known. */
function forProvider(provider, model) {
  const l = learned().providers[provider] || {};
  const o = (loadPrefs().providerContracts || {})[provider] || {};
  const pick = src => Object.fromEntries(FIELDS.filter(k => src?.[k] !== undefined).map(k => [k, src[k]]));
  return { ...pick(l), ...pick(l.models?.[model]), ...pick(o), ...pick(o.models?.[model]) };
}

/** Record what a retry proved. `perModel` for a fact about one model rather than the server. */
function learn(provider, model, facts, { perModel = false } = {}) {
  if (!provider) return;
  const doc = learned();
  const p = doc.providers[provider] ||= {};
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

/** The request body reshaped to the contract: the token field renamed, usage frames left out. */
function shape(body, c) {
  let out = body;
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

function all() { return learned().providers; }

module.exports = { forProvider, learn, forget, shape, all, FIELDS };
