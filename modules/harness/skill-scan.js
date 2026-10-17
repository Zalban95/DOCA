'use strict';

/**
 * A skill's text read for what must never come in by itself (the agent's `skill get`, 2026-10-17: the owner asked that
 * the harness find and get the skills it needs). Mechanical, no model: patterns a skill has no reason to carry — words
 * aimed at the agent's own rules (ignore previous instructions, you are now…), sending what it holds somewhere (a key,
 * a token, a password, the environment, ~/.ssh), a downloaded script piped into a shell, a long encoded blob, characters
 * a person cannot see. A finding refuses the import with what and where; a person can still bring it in from
 * Settings → Harness → Skills, where they read it first. Keys themselves are secret-scan.js's.
 */
const RULES = [
  { re: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|your|system|all)\b[^.\n]{0,30}\b(?:instructions?|rules|prompt|guidelines)\b/gi, what: 'words aimed at the agent\'s own rules' },
  { re: /\byou are now\b|\bnew (?:system )?instructions\b|\bact as (?:an? )?(?:unrestricted|jailbroken|DAN)\b/gi, what: 'words that try to replace who the agent is' },
  { re: /\b(?:send|post|upload|exfiltrat\w*|leak|forward)\b[^.\n]{0,60}\b(?:api[ _-]?keys?|tokens?|passwords?|secrets?|credentials?|cookies?|\.env|ssh keys?|~\/\.ssh|environment variables)\b/gi, what: 'sending what the agent holds somewhere' },
  { re: /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|\b(?:bash|sh)\s+<\(\s*(?:curl|wget)/gi, what: 'a downloaded script piped into a shell' },
  { re: /\$\{?(?:[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD))\}?[^\n]{0,80}\b(?:curl|wget|nc|fetch)\b|\b(?:curl|wget)\b[^\n]{0,120}\$\{?[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)/g, what: 'a secret from the environment put into a request' },
  { re: /[A-Za-z0-9+/]{240,}={0,2}/g, what: 'a long encoded blob' },
  { re: /[​-‏‪-‮⁦-⁩﻿]/g, what: 'characters a person cannot see' },
];

const lineOf = (text, index) => String(text).slice(0, index).split('\n').length;

/** [{line, what}] for one text (a SKILL.md, a script beside it); empty when nothing is found. */
function scan(text, { file = 'SKILL.md' } = {}) {
  const out = [];
  for (const r of RULES) for (const m of String(text || '').matchAll(r.re)) {
    out.push({ file, line: lineOf(text, m.index), what: r.what });
    if (out.length >= 20) return out;
  }
  return out;
}

module.exports = { scan, RULES };
