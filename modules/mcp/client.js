'use strict';

/**
 * A small MCP client.
 *
 * MCP is JSON-RPC 2.0 over one of two transports. `stdio` spawns the server and
 * exchanges newline-delimited JSON with it; `http` POSTs to a URL, and holds
 * the URL's GET event stream open for what the server pushes. Both are
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
// Only explicit connectivity failures reported by a tool count. A timeout may
// just be a long render; initialize/tools/list say nothing about an app behind it.
const BACKEND_UNREACHABLE = /\b(?:ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|connection refused|network is unreachable|no route to host|cannot connect to|could not connect to)\b/i;
const BACKEND_FRESH_MS = 60000;

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
    this._backendFailureAt = null;
    this._lifecycle = 0;
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
    const how = require('./spawn-spec').spawnSpec(this.spec.command, this.spec.args || []);   // npx.cmd on Windows
    const child = spawn(how.file, how.args, {
      cwd: this.spec.cwd || undefined,
      env: { ...process.env, ...(this.spec.env || {}) }, ...how.opts,
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
    if (msg.id === undefined) return this._onNotification(msg);
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);
    if (msg.error) pending.reject(Object.assign(new Error(msg.error.message || 'JSON-RPC error'), { fromMcpServer: true }));
    else pending.resolve(msg.result);
  }

  /**
   * A server's notification. The one acted on: its tool list changed, so it is
   * read again — the agent's next step sees the new tools, where it used to take
   * someone pressing ↺ Tools. Several in a burst cost one tools/list.
   */
  _onNotification(msg) {
    if (msg.method !== 'notifications/tools/list_changed' || this.state !== 'running') return;
    this._note('the server says its tools changed; reading them again');
    clearTimeout(this._relist);
    this._relist = setTimeout(() => this.listTools().catch(e => this._note(`tools/list after a change failed: ${e.message}`)), 200);
    this._relist.unref?.();
  }

  /**
   * Streamable HTTP's other half: the GET stream a server pushes notifications
   * on. A 405 (or 404) means it offers none, which is allowed and ends this.
   * A dropped stream is reopened for as long as the client runs, and the log
   * says so. It used to stop after six tries (~1 min) in silence: a listener
   * away longer left the old tool list until ↺ (DocaDesk ISSUES.md D-25).
   */
  async _listen(lifecycle) {
    let failures = 0;
    let lost = false;
    while (this.state === 'running' && lifecycle === this._lifecycle) {
      const ctrl = this._stream = new AbortController();
      const opened = Date.now();
      try {
        const headers = { Accept: 'text/event-stream', ...(this.spec.headers || {}) };
        if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
        const res = await fetch(this.spec.url, { method: 'GET', headers, signal: ctrl.signal });
        if (res.status === 405 || res.status === 404) { res.body?.cancel?.().catch(() => {}); return; }
        if (res.ok && res.headers.get('content-type')?.includes('event-stream')) {
          if (lost) {   // whatever changed while it was away was said to nobody
            this._note('event stream back; reading the tools again');
            lost = false;
            this.listTools().catch(e => this._note(`tools/list after the stream came back failed: ${e.message}`));
          }
          await this._readStream(res.body);
        } else res.body?.cancel?.().catch(() => {});
      } catch { /* refused, reset or aborted: decided below */ }
      if (ctrl.signal.aborted) return;
      failures = Date.now() - opened > 60000 ? 1 : failures + 1;   // a stream that lived a while was not a failure
      if (!lost) { this._note('event stream closed; reopening until it is back'); lost = true; }
      const { baseMs, maxMs } = McpClient.streamBackoff;
      await new Promise(r => setTimeout(r, Math.min(maxMs, baseMs * 2 ** Math.min(failures, 16))).unref?.());
    }
  }

  /** SSE frames off the GET stream: each data payload is one JSON-RPC message. */
  async _readStream(body) {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of body) {
      buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      let end;
      while ((end = buf.indexOf('\n\n')) >= 0) {
        const data = sseData(buf.slice(0, end));
        buf = buf.slice(end + 2);
        try { const m = data && JSON.parse(data); if (m?.method && m.id === undefined) this._onNotification(m); } catch { /* not JSON */ }
      }
    }
  }

  _send(obj) {
    if (!this.child?.stdin?.writable) throw new Error('server is not running');
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  /**
   * How long to wait, and where that number comes from.
   *
   * These used to be literals at the two call sites, which made them the kind of
   * limit that stops a turn without being able to say so: the agent hit one
   * mid-render, went looking, found the `= 30000` default on `request()` and
   * reported that as the cause. It was wrong — `callTool` passes its own value
   * and always has — but it was a reasonable reading of code where the real
   * number is written somewhere else entirely. Now there is one place, it has a
   * name, and the name is in the timeout message.
   */
  static timeoutFor(kind) {
    const fallback = kind === 'list' ? 20000 : 120000;
    try {
      const { loadPrefs } = require('../utils');
      const n = Number(loadPrefs()?.mcpSettings?.[kind === 'list' ? 'listTimeoutMs' : 'callTimeoutMs']);
      return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
    } catch { return fallback; }
  }

  async _httpRequest(method, params, timeoutMs) {
    const headers = {
      'Content-Type': 'application/json',
      // A streamable-HTTP server may answer with either shape.
      Accept: 'application/json, text/event-stream',
      ...(this.spec.headers || {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const id = this._nextId++;

    let res;
    try {
      res = await fetch(this.spec.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // Node's own text for an aborted fetch is "The operation was aborted due
      // to timeout" — no number, no owner, and no hint of the thing that makes
      // this timeout different from every other one: we stopped waiting, the
      // work did not stop. A render that outlives the wait still finishes and
      // still writes its file, so an agent that retries blindly does it twice.
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError')
        throw new Error(
          `${method} gave up after ${Math.round(timeoutMs / 1000)}s waiting for "${this.id}". `
          + 'That is this panel\'s limit (settings mcpSettings.callTimeoutMs), not the server\'s — '
          + 'and it stopped the waiting, not the work: whatever you asked for may have finished on that '
          + 'machine anyway. Check the result before asking for it again.');
      throw e;
    }
    const session = res.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

    const body = await res.text();
    let json;
    if (res.headers.get('content-type')?.includes('event-stream')) {
      // SSE framing: the reply is the frame carrying our id; a server may send
      // notifications on the same response before it, and those are heard too.
      const frames = body.replace(/\r\n/g, '\n').split('\n\n').map(sseData).filter(Boolean).map(d => { try { return JSON.parse(d); } catch { return null; } }).filter(Boolean);
      for (const m of frames) if (m.method && m.id === undefined) this._onNotification(m);
      json = frames.find(m => m.id === id) || frames.find(m => 'result' in m || 'error' in m) || {};
    } else json = JSON.parse(body || '{}');

    if (json.error) throw Object.assign(new Error(json.error.message || 'JSON-RPC error'), { fromMcpServer: true });
    return json.result;
  }

  /* ── Requests ──────────────────────────────────────── */

  request(method, params, timeoutMs = McpClient.timeoutFor('call')) {
    if (this.transport === 'http') return this._httpRequest(method, params, timeoutMs);

    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(
          `${method} gave up after ${Math.round(timeoutMs / 1000)}s waiting for "${this.id}". `
          + 'That is this panel\'s limit (settings mcpSettings.callTimeoutMs), not the server\'s — '
          + 'and it stopped the waiting, not the work. Check the result before asking for it again.'));
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
    this._lifecycle++;
    this._backendFailureAt = null;
    this.error = null;
    this.log   = [];

    try {
      if (this.transport === 'stdio') this._spawn(); else if (this.transport === 'socket') require('./socket-hosts').attach(this);   // a device's own socket

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
      // Only a server that says its tool list can change is listened to: some answer a GET badly, or not at all.
      if (this.transport === 'http' && info?.capabilities?.tools?.listChanged) this._listen(this._lifecycle);   // not awaited
      return this;
    } catch (e) {
      this.error = e.message;
      this.state = 'error';
      this.stop(true);
      throw e;
    }
  }

  async listTools() {
    const res = await this.request('tools/list', {}, McpClient.timeoutFor('list'));
    this.tools = (res?.tools || []).map(t => ({
      name:        t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      // `readOnlyHint`: a tool only looks (absent, assume it can change something); `openWorldHint`: it reads the open world.
      readOnly:    !!t.annotations?.readOnlyHint, openWorld: !!t.annotations?.openWorldHint,
    }));
    return this.tools;
  }

  /**
   * Call a tool. MCP replies with content blocks; the model wants text, so the
   * text ones are joined and anything else is named rather than dropped
   * silently — "[image]" tells the model something came back that it cannot see.
   */
  async callTool(name, args) {
    const lifecycle = this._lifecycle;
    const observe = failure => {
      if (this.state === 'running' && lifecycle === this._lifecycle)
        this._backendFailureAt = failure ? Date.now() : null;
    };
    try {
      const res = await this.request('tools/call', { name, arguments: args || {} }, McpClient.timeoutFor('call'));
      const text = (res?.content || [])
        .map(c => (c.type === 'text' ? c.text : require('./content').keep(c, this.spec.id)))
        .join('\n')
        .trim();
      observe(res?.isError && BACKEND_UNREACHABLE.test(text));
      if (res?.isError) return `Error: ${text || 'the tool reported a failure'}`;
      return text || '(no output)';
    } catch (e) {
      // A local fetch/stdio failure describes the MCP transport, not its backend.
      observe(e.fromMcpServer && BACKEND_UNREACHABLE.test(e.message));
      throw e;
    }
  }

  backendStatus() {
    const at = this.state === 'running' ? this._backendFailureAt : null;
    return {
      backend: at !== null && Date.now() - at < BACKEND_FRESH_MS ? 'unreachable' : 'unknown',
      backendObservedAt: at !== null ? new Date(at).toISOString() : null,
    };
  }

  stop(quiet) {
    const child = this.child;
    this.state = 'stopped';
    this._lifecycle++;
    this._backendFailureAt = null;
    this.tools = [];
    this._stream?.abort();
    clearTimeout(this._relist);
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

/** The data of one SSE frame (its `data:` lines joined), or ''. */
function sseData(frame) {
  return frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n').trim();
}

McpClient.streamBackoff = { baseMs: 500, maxMs: 30000 };   // reopening a stream: 1 s, 2 s … 30 s; tests shrink it

module.exports = { McpClient, PROTOCOL_VERSION };
