'use strict';

/**
 * What leaves the hive is looked at for keys first (fit audit 2026-10-14, item 12): a pack exported, kept or sent to
 * another hub, a pack shared with the project, a skill saved or brought in, the agent's service and MCP drafts. A
 * customer's key pasted into a skill's example, a memory entry or a draft's argument would otherwise travel with it.
 *
 * Mechanical, no model: shapes the issuers publish (Google's AIza…, `sk-` keys, GitHub's ghp_/github_pat_, Slack's
 * xox…, AWS's AKIA…, a PEM private key with a body, a JWT), and a long high-entropy value assigned to a name that says
 * token/key/secret/password. A finding is a line and a kind — never the value, which is the whole point; the refusal
 * names the file, the line and the kind, so the person finds it without the hub repeating it. Placeholders are not
 * findings: the hub's own MASK, `sk-...`, YOUR_KEY, `<token>`, `${VAR}`, AWS's documented …EXAMPLE ids, short strings.
 */

const KINDS = {
  google: 'a Google API key', openai: 'an sk- API key (OpenAI, Anthropic and others)', github: 'a GitHub token',
  slack: 'a Slack token', aws: 'an AWS access key id', pem: 'a private key (PEM)', jwt: 'a JSON Web Token',
  assigned: 'a long random value given to a token, key, secret or password',
};

const SHAPES = [
  ['google', /AIza[0-9A-Za-z_-]{35}/g],
  ['openai', /\bsk-(?:[a-z]+-){0,2}[A-Za-z0-9_-]{20,}/g],
  ['github', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
  ['slack', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['aws', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];
const PEM = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const PEM_BODY = /^[A-Za-z0-9+/=]{40,}$/;
// A name that says secret, then = or :, then the value (quoted or not).
const ASSIGNED = /([A-Za-z0-9_.-]*(?:token|key|secret|passw(?:or)?d|pwd)[A-Za-z0-9_-]*)["']?\s*[:=]\s*["'`]?([A-Za-z0-9+/_\-=.~]{20,})/gi;
const PLACEHOLDER = /(?:example|your[_-]?|my[_-]?(?:key|token|secret)|x{4,}|\.{3}|changeme|placeholder|dummy|redacted|sample|fake|test[_-]?key|replace)/i;
const MASK = '••••••••';

/** Shannon entropy in bits per character. */
function entropy(s) {
  const n = {};
  for (const c of s) n[c] = (n[c] || 0) + 1;
  return Object.values(n).reduce((h, k) => h - (k / s.length) * Math.log2(k / s.length), 0);
}

/** A value that is random enough to be a secret: letters and digits mixed, entropy high for its alphabet. */
function random(v) {
  if (PLACEHOLDER.test(v) || /^(?:process\.env|env\.|\$)/.test(v)) return false;
  if (!/\d/.test(v) || !/[A-Za-z]/.test(v)) return false;
  if (/^[0-9a-f]+$/i.test(v)) return v.length >= 32 && entropy(v) >= 3;
  if (/^[A-Za-z_]+[A-Za-z0-9_.-]*$/.test(v) && /[._-]/.test(v) && !/\d{3,}/.test(v)) return false;   // an identifier, a dotted name
  return v.length >= 24 && entropy(v) >= 3.5;
}

const placeholder = (v, kind) => v.includes(MASK) || PLACEHOLDER.test(v) || (kind === 'aws' && /EXAMPLE$/.test(v))
  || (['openai', 'slack'].includes(kind) && !/\d/.test(v));   // a hyphenated word, not a key

/**
 * Findings in one text: [{line, kind}], one per kind per line, never the matched value.
 * @param {string} text
 * @param {{name?: string}} [opts] the file's name, carried on each finding when given
 */
function scan(text, { name } = {}) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  const add = (i, kind) => { if (!out.some(f => f.line === i + 1 && f.kind === kind)) out.push({ ...(name ? { file: name } : {}), line: i + 1, kind }); };
  lines.forEach((l, i) => {
    if (l.length < 20) return;
    for (const [kind, re] of SHAPES) for (const m of l.matchAll(re)) if (!placeholder(m[0], kind)) add(i, kind);
    if (PEM.test(l)) {
      const next = lines.slice(i + 1).find(x => x.trim());
      if (next && PEM_BODY.test(next.trim())) add(i, 'pem');
    }
    for (const m of l.matchAll(ASSIGNED)) {
      if (out.some(f => f.line === i + 1)) break;   // a named shape on this line already says it
      if (random(m[2])) add(i, 'assigned');
    }
  });
  return out;
}

/** A file that is not text (a NUL in its first 8 KB) is not read: keys in images are not this scanner's job. */
const binary = b => Buffer.isBuffer(b) && b.subarray(0, 8192).includes(0);

/** Findings in a list of files {name, text} or {name, data: Buffer|string}, e.g. the entries of a zip. */
function scanFiles(files = []) {
  const out = [];
  for (const f of files) {
    const body = f.text !== undefined ? f.text : f.data;
    if (body === undefined || body === null || binary(body)) continue;
    out.push(...scan(Buffer.isBuffer(body) ? body.toString('utf8') : String(body), { name: f.name }));
  }
  return out;
}

/** Every text file inside a zip (a .dpack). */
const scanZip = buffer => scanFiles(require('./packs/zip').read(buffer));

/** One sentence per finding: where, and what it looks like — never the value. */
function sentence(findings, doing = 'This') {
  const where = findings.slice(0, 5).map(f => `${f.file ? `${f.file} ` : ''}line ${f.line} (${KINDS[f.kind] || f.kind})`);
  const more = findings.length > 5 ? ` and ${findings.length - 5} more` : '';
  return `${doing} was stopped: ${where.join('; ')}${more} looks like a secret. Take it out — keep keys in Field → Connectors → Keys for services or Secrets for your devices — and try again.`;
}

/** Throw a 422 naming the findings when there are any; return nothing otherwise. */
function refuse(findings, doing) {
  if (!findings.length) return;
  throw Object.assign(new Error(sentence(findings, doing)), { status: 422, code: 'secret_found', findings });
}

const guard = (files, doing) => refuse(scanFiles(files), doing);
const guardText = (text, name, doing) => refuse(scan(text, { name }), doing);

module.exports = { scan, scanFiles, scanZip, sentence, refuse, guard, guardText, KINDS };
