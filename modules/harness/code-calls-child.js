'use strict';

/**
 * The child process a `run_code` script runs in (harness/code-calls.js). It receives the script, runs it as the body of
 * an async function given `tools` — `await tools.read_file({ path })` — and `call(name, args)`, and each call goes to
 * the parent as a message: the parent runs it through the turn's own gates and sends the result back. What the script
 * prints is its output; what it returns, its value. It holds no secret: the parent gives it a bare environment.
 */
const pending = new Map();
let next = 0;

const call = (name, args = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  pending.set(id, m => (m.error ? reject(new Error(m.error)) : resolve(m.result)));
  process.send({ type: 'call', id, name: String(name), args: args && typeof args === 'object' ? args : {} });
});
const tools = new Proxy({}, { get: (_, name) => (typeof name === 'string' && name !== 'then' ? args => call(name, args) : undefined) });

async function run(code) {
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const value = await new AsyncFunction('tools', 'call', code)(tools, call);
    let out = null;
    try { out = value === undefined ? null : JSON.parse(JSON.stringify(value)); } catch { out = String(value); }
    process.send({ type: 'done', value: out });
  } catch (e) {
    process.send({ type: 'done', error: String((e && e.stack) || e).split('\n').slice(0, 6).join('\n').slice(0, 1500) });
  }
}

process.on('message', m => {
  if (m?.type === 'run') run(String(m.code || ''));
  else if (m?.type === 'result') { const f = pending.get(m.id); pending.delete(m.id); f?.(m); }
});
