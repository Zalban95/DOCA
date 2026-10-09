'use strict';

/**
 * The floating chat with a harness that is not the built-in one (TODO H11.1). It used to hard-code one road for all
 * of them — OpenClaw's gateway, else `claude -p` — whichever harness was the default. Each harness now says how it is
 * asked one question without a terminal, and the chat asks the default one that way:
 *
 *   gateway   an OpenAI-compatible /chat/completions it serves (OpenClaw's gateway, from openclaw.json)
 *   argv      its own non-interactive mode, a catalog row's `oneShot` (`claude -p`, `codex exec`, `gemini -p`, …),
 *             run by argv with no shell — the message is one argument, never parsed — in the workspace, stdin closed
 *
 * A harness with neither says so and points at the Harness tab, where it runs in its own terminal; nothing silently
 * falls back to a different agent. These are other people's agents acting on this machine with their own permission
 * models, so only a host's chat reaches them (modules/chat.js). Only the built-in harness understands attachments.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const TIMEOUT_MS = 10 * 60 * 1000;

/** openclaw.json, read tolerantly (control characters and trailing commas). */
function parseOpenclawConfig() {
  const raw = fs.readFileSync(require('../paths').CONFIG_PATH, 'utf8').replace(/[\x00-\x1F\x7F]/g, ' ').replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw);
}

/** OpenClaw's gateway, when openclaw.json enables its chat completions endpoint. */
function gatewayConfig() {
  try {
    const gw = parseOpenclawConfig()?.gateway || {};
    if (!gw?.http?.endpoints?.chatCompletions?.enabled) return null;
    const envUrl = process.env.OPENCLAW_GATEWAY_URL;
    const url = envUrl ? `${envUrl.replace(/\/$/, '')}/v1/chat/completions` : `http://127.0.0.1:${process.env.OPENCLAW_GATEWAY_PORT || gw?.port || 18789}/v1/chat/completions`;
    const token = require('../utils').resolveEnvVars(gw?.auth?.token || gw?.auth?.password || '');
    return { url, token: token || null };
  } catch { return null; }
}

/** How a harness row is asked one question: {kind: 'gateway'|'argv', …}, or null. */
function adapterFor(row) {
  if (!row) return null;
  if (row.id === 'openclaw') { const gw = gatewayConfig(); return gw ? { kind: 'gateway', ...gw } : null; }
  if (Array.isArray(row.oneShot) && row.cmd) return { kind: 'argv', cmd: row.cmd, args: row.oneShot };
  return null;
}

/** Why there is no adapter, in a sentence the chat can show. */
function whyNot(row) {
  if (!row) return 'No harness is the default.';
  if (row.id === 'openclaw') return 'OpenClaw answers here through its gateway: enable gateway.http.endpoints.chatCompletions in openclaw.json.';
  if (row.id === 'opendots') return 'OpenDots answers in its own page (Controls → OpenDots → Open); talking to it from here needs its Intelligence SDK and is not built yet.';
  return `${row.label} has no one-question mode DOCA knows of: open it on the Harness tab, where it runs in its own terminal — or make DOCA's own agent the default.`;
}

/** The gateway: the chat's history as messages, the answer streamed as text. */
async function viaGateway(a, { history, signal, onText }) {
  const resp = await fetch(a.url, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-openclaw-agent-id': 'main', ...(a.token ? { Authorization: `Bearer ${a.token}` } : {}) },
    body: JSON.stringify({ model: 'openclaw', stream: true, messages: history }) });
  if (!resp.ok) throw new Error(`Gateway ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const reader = resp.body.getReader(), dec = new TextDecoder();
  let buf = '', out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try { const t = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content; if (t) { out += t; onText(t); } } catch { /* a partial frame */ }
    }
  }
  return { text: out, code: 0 };
}

/** A CLI's own non-interactive mode, by argv. */
function viaArgv(a, { message, signal, onText = () => {}, onErr = () => {}, cwd, timeoutMs }) {
  if (require('../hosted').on()) return Promise.reject(require('../hosted').refusal('Another agent run as a program on the hub'));   // hosted.js
  const shell = require('../shell');
  const bin = shell.which(a.cmd);
  if (!bin) return Promise.resolve({ text: '', code: 127, error: `${a.cmd} is not installed (or not on PATH).` });
  const args = a.args.map(x => (x === '{message}' ? message : x));
  // An npm-installed CLI is a .cmd shim on Windows, which only cmd.exe runs (mcp/spawn-spec.js): there the message is
  // one quoted argument, so & | < > stay text — though cmd still expands a %NAME% written in it.
  const spec = require('../mcp/spawn-spec').spawnSpec(bin, args);
  return new Promise(resolve => {
    let out = '';
    const child = spawn(spec.file, spec.args, { ...spec.opts, cwd: cwd || require('../paths').WORKSPACE_DIR, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), timeoutMs || TIMEOUT_MS);
    signal?.addEventListener('abort', () => child.kill());
    child.on('error', e => { clearTimeout(timer); resolve({ text: out, code: 1, error: `${a.cmd}: ${e.message}` }); });
    child.stdout.on('data', d => { const t = d.toString(); out += t; onText(t); });
    child.stderr.on('data', d => onErr(d.toString()));
    child.on('close', code => { clearTimeout(timer); resolve({ text: out, code: code ?? 1 }); });
  });
}

/** Ask the harness one question. Resolves {text, code, error?}. */
function ask(adapter, opts) {
  require('../features/usage').count(`oneshot:${adapter.kind}`);   // an alternative beside the built-in harness (features/review.js)
  return adapter.kind === 'gateway' ? viaGateway(adapter, opts) : viaArgv(adapter, opts);
}

module.exports = { adapterFor, whyNot, ask, gatewayConfig, parseOpenclawConfig };
