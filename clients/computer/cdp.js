'use strict';

/**
 * A minimal Chrome DevTools Protocol client over Node's built-in WebSocket —
 * no dependency, so the computer's image needs nothing from npm. One page
 * target, request/response by id, and waiting for one event.
 */
class Cdp {
  constructor(port = 9222) { this.port = port; this.ws = null; this.seq = 0; this.pending = new Map(); this.waiters = []; }

  async connect() {
    if (this.ws && this.ws.readyState === 1) return this;
    let targets = [];
    for (let i = 0; i < 40; i++) {   // Chromium may still be starting
      try { targets = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json(); break; }
      catch { await new Promise(r => setTimeout(r, 250)); }
    }
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: 'PUT' })).json();
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('cannot reach Chromium over CDP')); });
    this.ws.onmessage = ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        this.waiters = this.waiters.filter(w => (w.method === msg.method ? (w.resolve(msg.params), false) : true));
      }
    };
    this.ws.onclose = () => { this.ws = null; };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    return this;
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
    });
  }

  once(method, timeoutMs = 15000) {
    return new Promise(resolve => {
      const w = { method, resolve };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); resolve(null); }, timeoutMs);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

module.exports = { Cdp };
