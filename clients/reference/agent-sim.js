#!/usr/bin/env node
'use strict';

/**
 * Agent simulator — what the OpenClaw agent side of the protocol looks like.
 *
 *   DOCA_URL=https://host:4242 DOCA_TOKEN=doca_… node agent-sim.js [--once]
 *
 * It subscribes to its own push channel and:
 *   • answers `prompt.selected` (free-form text/voice/image) with an outcome,
 *     proving the resolver:"agent" path without any LLM,
 *   • logs every other event it receives (confirmations, sensor samples,
 *     device variables, device messages).
 *
 * Also exposes helper functions used by demo.sh via subcommands:
 *   node agent-sim.js prompt <targetDeviceId> [resolver]
 *   node agent-sim.js alert <targetDeviceId>
 *   node agent-sim.js sensors <targetDeviceId>
 *   node agent-sim.js artifact <targetDeviceId>
 */
const URL_ = process.env.DOCA_URL || 'https://localhost:4242';
const TOKEN = process.env.DOCA_TOKEN;
if (!TOKEN) { console.error('DOCA_TOKEN required'); process.exit(1); }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0'; // self-signed tailnet cert

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-Doca-Client': 'agent-sim/1.0' };
async function api(method, path, body) {
  const r = await fetch(URL_ + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const ANIMATED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#1f2731" stroke-width="10"/><circle cx="50" cy="50" r="42" fill="none" stroke="#3fb950" stroke-width="10" stroke-dasharray="264" stroke-dashoffset="26" transform="rotate(-90 50 50)"><animate attributeName="stroke-dashoffset" from="26" to="264" dur="4s" fill="freeze"/></circle><text x="50" y="56" font-size="18" text-anchor="middle" fill="#e6edf3" font-family="sans-serif">VRAM</text></svg>`;

const ACTIONS = {
  async prompt(target, resolver = 'agent') {
    return api('POST', '/api/v1/agent/prompts', {
      title: 'GPU 0 at 97 °C for 10 min', priority: 'high', targets: [target], resolver,
      body: [
        { type: 'text', text: 'vLLM is the only tenant. What should I do?' },
        { type: 'metric', metric: 'gpu.0.temp' },
        { type: 'figure', alt: 'VRAM drains 22 GB → 0 over 4 s', svg: ANIMATED, sizeHint: { w: 120, h: 120 },
          motion: { tracks: [{ type: 'ring', target: 'gpu.0.vram.pct', from: 0.9, to: 0, durationMs: 4000, easing: 'ease-out', color: 'ok' }], caption: 'VRAM ring empties' } },
      ],
      choices: [
        { id: 'stop', type: 'option', label: 'Stop vLLM', outcome: { summary: 'Stop container doca-vllm', detail: 'Frees 22 GB VRAM. Restart later from the Services page.', action: { commandId: 'services.stop', params: { id: 'vllm' } }, confirmLabel: 'Stop it' } },
        { id: 'wait', type: 'option', label: 'Wait 10 min', outcome: { summary: 'Re-check in 10 minutes', blocks: [{ type: 'kv', items: [{ k: 'Next check', v: '10 min' }] }] } },
        { id: 'say', type: 'voice', label: 'Tell me', maxSec: 20 },
        { id: 'type', type: 'text', label: 'Type instead', placeholder: 'e.g. cap power to 250W' },
        { id: 'shoot', type: 'image', label: 'Show me' },
        { id: 'no', type: 'dismiss', label: 'Ignore' },
      ],
      ext: { source: 'agent-sim', incident: 'gpu-temp-001' },
    });
  },
  alert(target) {
    return api('POST', '/api/v1/agent/alerts', { title: 'Backup finished', priority: 'normal', targets: [target], body: [{ type: 'text', text: '4.2 GB in 3 m 12 s' }] });
  },
  sensors(target) {
    return api('POST', '/api/v1/agent/sensors/requests', { deviceId: target, reason: 'HRV check before a risky restart', sensors: [{ id: 'heartRate', rateHz: 1, durationSec: 20 }, { id: 'accelerometer', rateHz: 10, durationSec: 5 }] });
  },
  async artifact(target) {
    const a = await api('POST', '/api/v1/agent/artifacts', { name: 'rmssd', runtime: 'js', entry: 'rmssd', purpose: 'HRV from RR intervals, computed on the device', params: { windowSec: 60 },
      content: 'export function rmssd(rr){let s=0;for(let i=1;i<rr.length;i++){const d=rr[i]-rr[i-1];s+=d*d}return Math.sqrt(s/Math.max(1,rr.length-1))}' });
    const d = await api('POST', `/api/v1/agent/artifacts/${a.artifact.id}/deliver`, { targets: [target], inline: true, message: 'run on each heartRate batch' });
    return { artifact: a.artifact, report: d.report };
  },
};

/** Turn a free-form selection into an outcome — a stand-in for the real agent's reasoning. */
function decide(payload) {
  const said = (payload.text || payload.transcript || payload.caption || '').toLowerCase();
  if (payload.kind === 'image') return { summary: 'Looked at your photo — no action', detail: `image ${payload.mediaUrl}` };
  const m = /(\d{2,3})\s*w/.exec(said);
  if (m) return { summary: `Cap GPU 0 power to ${m[1]} W`, blocks: [{ type: 'kv', items: [{ k: 'Before', v: '350 W' }, { k: 'After', v: `${m[1]} W` }] }], confirmLabel: 'Apply' };
  if (/stop|kill/.test(said)) return { summary: 'Stop container doca-vllm', action: { commandId: 'services.stop', params: { id: 'vllm' } }, confirmLabel: 'Stop it' };
  return { summary: `Noted: "${said.slice(0, 60)}" — nothing to run`, confirmLabel: 'OK' };
}

async function listen(once) {
  const me = await api('GET', '/api/v1/capabilities');
  log(`agent ${me.device.id} listening (cursor ${me.push.cursor}, ${me.push.pending} pending)`);
  const res = await fetch(`${URL_}/api/v1/events?since=0`, { headers: { ...H, Accept: 'text/event-stream' } });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = frame.split('\n').find(l => l.startsWith('data:'));
      if (!data) continue;
      const ev = JSON.parse(data.slice(5));
      if (!ev.type) { log('hello', JSON.stringify(ev)); continue; }
      log(`← ${ev.type} #${ev.seq}`, JSON.stringify(ev.payload).slice(0, 220));
      if (ev.type === 'prompt.selected' && ev.payload.resolver === 'agent') {
        const outcome = decide(ev.payload.payload);
        await api('POST', `/api/v1/agent/prompts/${ev.payload.promptId}/outcome`, { selectionId: ev.payload.selectionId, outcome });
        log(`→ outcome for ${ev.payload.selectionId}: ${outcome.summary}`);
      }
      if (ev.ack) await api('POST', '/api/v1/events/ack', { seq: ev.seq });
      if (once && ev.type === 'prompt.confirmed') { log('done'); process.exit(0); }
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd && ACTIONS[cmd]) ACTIONS[cmd](...rest).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exit(1); });
else listen(cmd === '--once').catch(e => { console.error(e.message); process.exit(1); });
