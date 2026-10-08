'use strict';

/**
 * The built-in harness's defaults, today's and the ones it shipped before (deep test B, C1, 2026-10-08).
 *
 * Every save of the ⚙ — and Set-up's "Use it for DOCA's agent", which sends only a provider and a model — used to
 * write every default into the prefs file, the whole system prompt included, so a later release's better default
 * never reached that install, and the Orchestrator was handed the frozen copy as "Your owner's instructions". Now a
 * save keeps only what differs from today's default (`own`), and migration `2.330-harness-defaults` lifts a stored
 * value that equals today's default or a former one (`stale`), so the install follows the defaults again.
 *
 * A former system prompt is known by the sha256 of its trimmed text: every version DEFAULT_SYSTEM_PROMPT has had in
 * modules/harness/providers.js (read from git history, 2026-10-08). A prompt the owner edited matches none and stays.
 */
const crypto = require('crypto');

const FORMER_PROMPTS = new Set([
  '4f315938c3b8df45ea6c05f9566e5b7b81149f6660c305a2d4746be404b07ef5',   // 2026-10-07, the charter's rewrite (B8)
  '43b4a939c58e9431d67edc468ae8521c740002d0f5298deebb75b090d65289f6',   // 2026-10-04, escalation
  '5c438a3430acd28388de3c1857c5fa93b66de73be4249ff4ee42883c0972f4c0',   // 2026-09-10 to 2026-10-04
]);

/** Values a key held as its default before today's (a value equal to one is a default nobody chose). */
const FORMER_VALUES = {};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = t => crypto.createHash('sha256').update(String(t).replace(/\r\n/g, '\n').trim()).digest('hex');

/** Whether `text` is the shipped system prompt, today's or a former one — not something the owner wrote. */
function isShippedPrompt(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  const h = hash(t);
  return h === hash(require('./providers').DEFAULT_SYSTEM_PROMPT) || FORMER_PROMPTS.has(h);
}

/** Only what differs from today's defaults: what a save keeps. */
function own(config) {
  const d = require('./providers').defaultParams();
  return Object.fromEntries(Object.entries(config || {}).filter(([k, v]) => v !== undefined
    && !(k === 'systemPrompt' ? isShippedPrompt(v) : k in d && same(v, d[k]))));
}

/** Whether a stored value is a default nobody chose: today's, or one this key shipped with before. */
function stale(key, value) {
  const d = require('./providers').defaultParams();
  if (key === 'systemPrompt') return isShippedPrompt(value);
  return (key in d && same(value, d[key])) || (FORMER_VALUES[key] || []).some(v => same(v, value));
}

module.exports = { isShippedPrompt, own, stale, FORMER_PROMPTS, FORMER_VALUES };
