'use strict';

/**
 * Test harness: boots the Express app on an ephemeral HTTP port with a
 * fresh DOCA_DATA_DIR, and provides tiny HTTP / SSE clients.
 * Must be required before any module under modules/api-v1.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-test-'));
process.env.DOCA_DATA_DIR  = path.join(tmp, 'data');
process.env.DOCA_PREFS_FILE = path.join(tmp, 'prefs.json');
process.env.CONFIG_PATH    = path.join(tmp, 'openclaw.json');
process.env.COMPOSE_DIR    = tmp;
process.env.SKILLS_DIR     = path.join(tmp, 'skills');
process.env.WORKSPACE_DIR  = tmp;
process.env.ATTACHMENTS_DIR = path.join(tmp, 'attachments');
process.env.AGENTS_DIR      = path.join(tmp, 'agents');

const { createApp } = require('../server');
const devices  = require('../modules/api-v1/devices');
const { PRESETS } = require('../modules/api-v1/scopes');

let server, base;

async function start() {
  if (server) return base;
  server = http.createServer(createApp());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

async function stop() {
  if (!server) return;
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  server = null;
  require('../modules/api-v1/sampler').stop();
}

/** JSON request. Returns { status, body, headers }. */
async function api(token, method, p, body, headers = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + p, { method, headers: h, body: payload });
  const ct = res.headers.get('content-type') || '';
  const out = ct.includes('json') ? await res.json() : ct.startsWith('image/') || ct.includes('octet') || ct.startsWith('audio/') ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, body: out, headers: res.headers };
}

/** Open an SSE stream; returns { events, waitFor(pred|type, ms), close, hello }. */
function sse(token, since = 0) {
  const events = [];
  const waiters = [];
  const ctrl = new AbortController();
  let hello = null, closed = false, closeReason = null;
  const ready = new Promise((resolve, reject) => {
    fetch(`${base}/api/v1/events?since=${since}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: ctrl.signal })
      .then(async res => {
        if (res.status !== 200) return reject(new Error(`SSE ${res.status}`));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
              let ev = 'message', data = null;
              for (const line of frame.split('\n')) {
                if (line.startsWith('event:')) ev = line.slice(6).trim();
                else if (line.startsWith('data:')) data = line.slice(5).trim();
              }
              if (data == null) continue;
              const obj = JSON.parse(data);
              if (ev === 'hello') { hello = obj; resolve(); continue; }
              if (ev === 'close') { closeReason = obj.reason; continue; }
              events.push(obj);
              for (const w of [...waiters]) if (w.pred(obj)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(obj); }
            }
          }
        } catch (e) { if (e.name !== 'AbortError') throw e; }
        closed = true;
        for (const w of waiters) w.resolveClosed && w.resolveClosed();
      }).catch(reject);
  });
  return {
    events, ready,
    get hello() { return hello; }, get closed() { return closed; }, get closeReason() { return closeReason; },
    waitFor(predOrType, ms = 5000) {
      const pred = typeof predOrType === 'string' ? e => e.type === predOrType : predOrType;
      const found = events.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for ${predOrType}`)), ms);
        waiters.push({ pred, resolve: v => { clearTimeout(t); resolve(v); } });
      });
    },
    waitClosed(ms = 5000) {
      if (closed) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for close')), ms);
        waiters.push({ pred: () => false, resolve: () => {}, resolveClosed: () => { clearTimeout(t); resolve(); } });
      });
    },
    close() { ctrl.abort(); },
  };
}

/** Create a device directly (bypasses pairing). */
function mkDevice(name, preset, caps, extraScopes = []) {
  return devices.create({ name, scopes: [...PRESETS[preset], ...extraScopes], caps, kind: preset === 'agent' ? 'agent' : 'device' });
}

const WATCH_CAPS = { formFactor: 'watch', screen: { w: 450, h: 450, shape: 'round' }, input: { touch: true, voice: true }, audio: { mic: true, haptic: true }, render: ['image', 'sprite'], motion: ['1'], exec: ['js'], sensors: ['heartRate', { id: 'accelerometer', maxRateHz: 50 }, 'battery'] };
const PHONE_CAPS = { formFactor: 'phone', screen: { w: 1080, h: 2400 }, input: { touch: true, voice: true, text: true, camera: true }, audio: { mic: true, speaker: true }, render: ['svg', 'svg.smil', 'image'], motion: ['1'], exec: ['js', 'wasm'], sensors: ['location', 'magnetometer'] };

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { start, stop, api, sse, mkDevice, WATCH_CAPS, PHONE_CAPS, sleep, tmp, get base() { return base; } };
