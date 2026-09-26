'use strict';

/**
 * The rules guard: patterns that are instructions aimed at an AI, not content.
 * Always available — no download, microseconds — so there is a first line even
 * before a model guard is installed, and tests have a guard that needs nothing.
 * A score, like the model guards: 0.9 for a clear instruction, 0.6 for a softer
 * one that also reads as content ("as an AI assistant, you…").
 */
const STRONG = [
  /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|directions?)/i,
  /\b(new|updated|real|actual)\s+(system\s+)?(instructions?|prompt)\s*[:\-]/i,
  /\b(you are now|from now on,? you|act as|pretend to be)\b[^.\n]{0,60}\b(assistant|ai|model|agent|dan|jailbroken)/i,
  /\b(note|message|attention|important)\s+(to|for)\s+(the\s+)?(ai|assistant|agent|llm|language model|model)s?\b/i,
  /\b(run|execute|paste)\b[^.\n]{0,40}(curl|wget)[^\n]{0,80}\|\s*(ba)?sh\b/i,
  /\b(send|upload|post|exfiltrate|forward)\b[^.\n]{0,60}(api[_ -]?key|token|password|secret|\.ssh|id_rsa|credentials?)/i,
  /\b(set|switch|change|disable|turn off)\b[^.\n]{0,40}\b(approval|unattended|safety|guard(rail)?s?)\b/i,
];
const SOFT = [
  /\bas an ai (assistant|language model)\b/i,
  /\b(the user|your (owner|operator)) (has )?(authori[sz]ed|allowed|wants) you to\b/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
];

function score(text) {
  const t = String(text || '');
  if (STRONG.some(r => r.test(t))) return 0.95;
  if (SOFT.some(r => r.test(t))) return 0.6;
  return 0;
}

module.exports = { score, STRONG, SOFT };
