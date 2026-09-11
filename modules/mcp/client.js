'use strict';

/**
 * A small MCP client.
 *
 * MCP is JSON-RPC 2.0 over one of two transports. `stdio` spawns the server and
 * exchanges newline-delimited JSON with it; `http` POSTs to a URL. Both are
 * about a hundred lines, which is why this is hand-rolled rather than pulling in
 * the official SDK: it is ESM, and everything else in this project is CommonJS
 * with seven dependencies that all do heavy lifting.
 *
 * A server logs to stderr, so stderr is kept in a ring buffer and shown as the
 * server's log rather than being swallowed.
 */
const { spawn } = require('child_process');

const PROTOCOL_VERSION = '2025-06-18';
const LOG_LINES = 200;

class McpClient {
  /**
   * @param {{ id: string, transport?: 'stdio'|'http', command?: string, args?: string[],
   *           env?: object, cwd?: string, url?: string, headers?: object }} spec
   */
  constructor(spec) {
    this.spec    = spec;
    this.id      = spec.id;
    this.child   = null;
    this.state   = 'stopped';       // stopped | starting | running | error
    this.error   = null;
    this.tools   = [];
    this.serverInfo = null;
    this.sessionId  = null;         // set by an HTTP server that wants one
    this.startedAt  = null;
    this.log     = [];
    this._nextId = 1;
    this._pending = new Map();
    this._buf    = '';
  }

  get transport() { return this.spec.transport || 'stdio'; }

  _note(line) {
    for (const l of String(line).split('\n')) {
      if (l.trim()) this.log.push(l.replace(/\s+$/, ''));
    }
    if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES);
  }

  /* ── Transport ─────────────────────────────────────── */

  _spawn() {
    if (!this.spec.command) throw new Error('command required for a stdio server');
    const child = spawn(this.spec.command, this.spec.args || [], {
      cwd: this.spec.cwd || undefined,
      env: { ...process.env, ...(this.spec.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.on('data', chunk => {
      this._buf += chunk.toString();
      let nl;
      while ((nl = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, nl).trim();
        this._buf = this._buf.slice(nl + 1);
        if (!line) continue;
        try { this._onMessage(JSON.parse(line)); }
        catch { this._note(`[unparseable line] ${line.slice(0, 200)}`); }
      }
    });

    child.stderr.on('data', d => this._note(d.toString()));

    child.on('error', err => {
      this.state = 'error';
      this.error = err.code === 'ENOENT' ? `${this.spec.command}: not found` : err.message;
      this._note(`[error] ${this.error}`);
      this._failAll(this.error);
    });

    child.on('close', (code, signal) => {
      this.child = null;
      this.tools = [];
      // An exit we asked for is not a failure; one we did not is.
      if (this.state !== 'stopped') {
        this.state = 'error';
        this.error = this.error || `exited (${signal || `code ${code}`})`;
      }
      this._note(`[exit] ${signal || `code ${code}`}`);
      this._failAll('server exited');
    });
  }

  _failAll(reason) {
    for (const [, p] of this._pending) p.reject(new Error(reason));
    this._pending.clear();
  }

  /** A server may call us too. We implement nothing, so answer rather than hang. */
  _onMessage(msg) {
    if (msg.id !== undefined && msg.method) {
      return this._send({
        jsonrpc: '2.0', id: msg.id,
        error: { code: -32601, message: `${msg.method} is not supported by this client` },
      });
    }
    if (msg.id === undefined) return;                 // a notification, nothing to do
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message || 'JSON-RPC error'));
    else pending.resolve(msg.result);
  }

  _send(obj) {
    if (!this.child?.stdin?.writable) throw new Error('server is not running');
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  async _httpRequest(method, params, timeoutMs) {
    const headers = {
      'Content-Type': 'application/json',
      // A streamable-HTTP server may answer with either shape.
      Accept: 'application/json, text/event-stream',
      ...(this.spec.headers || {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const res = await fetch(this.spec.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: this._nextId++, method, params: params || {} }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const session = res.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

    const body = await res.text();
    const json = res.headers.get('content-type')?.includes('event-stream')
      // SSE framing: the JSON-RPC reply is the first data: payload.
      ? JSON.parse(body.split('\n').find(l => l.startsWith('data:'))?.slice(5).trim() || '{}')
      : JSON.parse(body || '{}');

    if (json.error) throw new Error(json.error.message || 'JSON-RPC error');
    return json.result;
  }

  /* ── Requests ──────────────────────────────────────── */

  request(method, params, timeoutMs = 30000) {
    if (this.transport === 'http') return this._httpRequest(method, params, timeoutMs);

    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      const done = fn => v => { clearTimeout(timer); fn(v); };
      this._pending.set(id, { resolve: done(resolve), reject: done(reject) });
      try { this._send({ jsonrpc: '2.0', id, method, params: params || {} }); }
      catch (e) { clearTimeout(timer); this._pending.delete(id); reject(e); }
    });
  }

  notify(method, params) {
    if (this.transport === 'http') return;            // nothing we send needs one
    try { this._send({ jsonrpc: '2.0', method, params: params || {} }); } catch { /* gone */ }
  }

  /* ── Lifecycle ─────────────────────────────────────── */

  /** Spawn (or reach) the server, complete the handshake and cache its tools. */
  async start() {
    if (this.state === 'running' || this.state === 'starting') return this;
    this.state = 'starting';
    this.error = null;
    this.log   = [];

    try {
      if (this.transport === 'stdio') this._spawn();

      const info = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities:    {},
        clientInfo:      { name: 'doca', version: require('../../package.json').version },
      }, 20000);

      this.serverInfo = info?.serverInfo || null;
      this.notify('notifications/initialized');
      await this.listTools();

      this.state     = 'running';
      this.startedAt = new Date().toISOString();
      return this;
    } catch (e) {
      this.error = e.message;
      this.state = 'error';
      this.stop(true);
      throw e;
    }
  }

  async listTools() {
    const res = await this.request('tools/list', {}, 20000);
    this.tools = (res?.tools || []).map(t => ({
      name:        t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      // `readOnlyHint` is how a server says a tool only looks at things. Absent
      // it, assume a tool can change something.
      readOnly:    !!t.annotations?.readOnlyHint,
    }));
    return this.tools;
  }

  /**
   * Call a tool. MCP replies with content blocks; the model wants text, so the
   * text ones are joined and anything else is named rather than dropped
   * silently — "[image]" tells the model something came back that it cannot see.
   */
  async callTool(name, args) {
    const res = await this.request('tools/call', { name, arguments: args || {} }, 120000);
    const text = (res?.content || [])
      .map(c => (c.type === 'text' ? c.text : `[${c.type}]`))
      .join('\n')
      .trim();
    if (res?.isError) return `Error: ${text || 'the tool reported a failure'}`;
    return text || '(no output)';
  }

  stop(quiet) {
    const child = this.child;
    this.state = 'stopped';
    this.tools = [];
    if (!quiet) this.error = null;
    if (child) {
      this.child = null;
      try {
        child.kill('SIGTERM');
        setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch {} }, 4000).unref();
      } catch { /* already gone */ }
    }
    this._failAll('stopped');
  }
}

module.exports = { McpClient, PROTOCOL_VERSION };
