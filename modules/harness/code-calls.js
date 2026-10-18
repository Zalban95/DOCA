'use strict';

/**
 * Programmatic tool calling — `run_code` (experiment codeCalls; Hermes Agent's execute_code; docs/experiments/
 * code-calls.md). The agent writes one short JavaScript script that calls its tools — read twenty files and write a
 * summary, try a command over every level, apply one edit across modules — and the steps a model would spend one call at
 * a time become one. Nothing gets through that a call would not: every tool the script calls is a tool call made through
 * the turn's own `runToolCalls`, in a conversation of the script's own under this one (as a recipe runs) — the mode, the
 * person's level and grants, the approval gate, forced asks, the control plane and the charter's tool rules are the
 * agent's, and every call and result is in that transcript. The script itself runs in a child Node process with a bare
 * environment (no keys), in the conversation's folder, stopped at its time limit; it may not call `run_code` again.
 * Held where `shell` is (the same reach: a script could do what `node -e` does), absent in a hosted hive, and a script
 * naming DOCA's own code folder is refused in production as a shell line is.
 */
const path = require('path');
const { spawn } = require('child_process');

const CHILD = path.join(__dirname, 'code-calls-child.js');
const MAX_CODE = 20000, MAX_CALLS = 60, MAX_OUT = 8000, MAX_RESULT = 20000;
const on = () => require('../experiments').on('codeCalls');
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}\n… (${String(s).length - n} more characters)` : String(s));

/** A bare environment: what a program needs to find itself, never a key. */
function bareEnv() {
  const keep = ['PATH', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'TZ'];
  return Object.fromEntries(keep.filter(k => process.env[k] != null).map(k => [k, process.env[k]]));
}

async function run({ code, timeoutSec = 120 }, ctx = {}) {
  if (!on()) return 'Error: run_code is an experiment that is off (Settings → Developer → codeCalls).';
  const text = String(code || '');
  if (!text.trim()) return 'Error: run_code needs code — the body of an async function that calls `await tools.<name>({...})`.';
  if (text.length > MAX_CODE) return `Error: the script is ${text.length} characters; at most ${MAX_CODE}. Split it, or write it to a file and run it with shell.`;
  const held = require('../edition-mode').shellRefusal(text, null);   // production: DOCA's own code, refused as a shell line is
  if (held) return `Error: ${held}`;
  if (!ctx.sessionId) return 'Error: run_code runs for a conversation, and this call has none.';
  const memory = require('./memory');
  const parent = memory.getSession(ctx.sessionId);
  if (!parent) return 'Error: no such conversation.';
  const fields = Object.fromEntries(['projectId', 'worktree', 'mode', 'approval'].filter(k => parent[k] != null).map(k => [k, parent[k]]));
  const child = memory.createSession(`Script · ${text.split('\n').find(l => l.trim())?.trim().slice(0, 80) || 'run_code'}`, { activate: false, parentId: parent.id, fields });
  memory.updateSession(child.id, { titleLocked: true });   // its title says what it ran, not its first message
  const owner = (() => { try { return require('./session-access').ownerOf(parent.id); } catch { return null; } })();
  if (owner) try { require('./session-access').claim({ id: owner }, child.id); } catch { /* no accounts */ }
  require('./repo').inherit(child.id, parent.id);
  memory.append(child.id, { role: 'user', content: `Run this script for "${parent.title}":\n\`\`\`js\n${text}\n\`\`\``, from: { name: 'Script' } });

  const { runToolCalls } = require('./turn/tool-calls');
  const tools = require('./tools');
  const disabled = Array.isArray(ctx.disabled) ? ctx.disabled : [...(ctx.disabled || [])];
  const isMission = !!require('../agents/missions').forSession(parent.id);
  const client = { name: 'Script', kind: 'script', user: ctx.user || null };
  const calls = [];
  let n = 0;
  const cwd = (() => { try { return require('./toolbox/common').cwd({ sessionId: parent.id }); } catch { return process.cwd(); } })();
  const proc = spawn(process.execPath, [CHILD], { cwd, env: bareEnv(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let out = '', err = '';
  proc.stdout.on('data', d => { out += d; if (out.length > MAX_OUT * 2) out = out.slice(-MAX_OUT * 2); });
  proc.stderr.on('data', d => { err += d; if (err.length > MAX_OUT) err = err.slice(-MAX_OUT); });

  const answer = async m => {
    const name = String(m.name || '');
    if (++n > MAX_CALLS) return proc.send({ type: 'result', id: m.id, error: `at most ${MAX_CALLS} tool calls a script` });
    if (name === 'run_code') return proc.send({ type: 'result', id: m.id, error: 'a script cannot run another script' });
    const tc = { id: `sc_${n}`, type: 'function', function: { name, arguments: JSON.stringify(m.args || {}) } };
    memory.append(child.id, { role: 'assistant', content: '', tool_calls: [tc] });
    await runToolCalls({ reply: { tool_calls: [tc] }, schemas: tools.schemas(disabled), stepDisabled: disabled, session: memory.getSession(child.id),
      signal: ctx.signal, client, profile: ctx.profile || null, isMission, step: n, say: e => ctx.emit?.(e), announced: new Set() });
    const result = String(memory.messages(child.id).filter(r => r.role === 'tool').pop()?.content || '');
    calls.push({ name, failed: /^(Error|Refused|Denied|Not run)/.test(result.trim()) });
    proc.send({ type: 'result', id: m.id, result: clip(result, MAX_RESULT) });
  };

  const done = await new Promise(resolve => {
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } resolve({ error: `stopped at its time limit (${timeoutSec} s)` }); }, Math.max(5, Math.min(600, Number(timeoutSec) || 120)) * 1000);
    ctx.signal?.addEventListener?.('abort', () => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, { once: true });
    proc.on('message', m => {
      if (m?.type === 'call') answer(m).catch(e => proc.send({ type: 'result', id: m.id, error: String(e.message || e) }));
      if (m?.type === 'done') { clearTimeout(timer); resolve(m); }
    });
    proc.on('exit', code => { clearTimeout(timer); resolve({ error: `the script's process ended (${code})${err ? `: ${err.trim().slice(-600)}` : ''}` }); });
    proc.send({ type: 'run', code: text });
  });
  try { proc.kill(); } catch { /* ended */ }
  const failed = calls.filter(c => c.failed).length;
  const summary = `${calls.length} tool call${calls.length === 1 ? '' : 's'}${calls.length ? ` (${[...new Set(calls.map(c => c.name))].join(', ')})` : ''}${failed ? `, ${failed} failed or refused` : ''}`;
  memory.append(child.id, { role: 'assistant', content: done.error ? `Script stopped: ${done.error}` : `Script done: ${summary}.` });
  return [done.error ? `Error: the script stopped — ${done.error}. It made ${summary}.` : `Script done: ${summary}.`,
    out.trim() ? `Output:\n${clip(out.trim(), MAX_OUT)}` : '',
    !done.error && done.value != null ? `Returned: ${clip(typeof done.value === 'string' ? done.value : JSON.stringify(done.value, null, 1), MAX_OUT)}` : '',
    `Its calls and their results: the conversation "${memory.getSession(child.id)?.title}" (${child.id}).`].filter(Boolean).join('\n');
}

module.exports = { run, on, MAX_CALLS };
