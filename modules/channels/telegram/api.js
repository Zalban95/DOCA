'use strict';

/**
 * The Telegram Bot API, as much of it as the channel uses: JSON calls, one multipart upload, one file
 * download. No dependency — Node's fetch, FormData and Blob. The token is read per call (prefs
 * `channels.telegram.botToken`, or TELEGRAM_BOT_TOKEN) and never appears in an error or a log line.
 * `channels.telegram.apiBase` / DOCA_TELEGRAM_API point it elsewhere: a local Bot API server, or the tests' stub.
 */
const prefs = () => require('../../utils').loadPrefs().channels?.telegram || {};
const base = () => String(process.env.DOCA_TELEGRAM_API || prefs().apiBase || 'https://api.telegram.org').replace(/\/+$/, '');
const token = () => String(process.env.TELEGRAM_BOT_TOKEN || prefs().botToken || '');

const fail = (method, why, extra = {}) => Object.assign(new Error(`Telegram ${method}: ${why}`), { status: 502, ...extra });
const signalFor = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

async function call(method, params = {}, { signal, timeoutMs = 30000 } = {}) {
  if (!token()) throw fail(method, 'no bot token (Settings → Channels)', { status: 409 });
  let r;
  try {
    r = await fetch(`${base()}/bot${token()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params), signal: signalFor(signal, timeoutMs) });
  } catch (e) { throw fail(method, e.name === 'AbortError' || e.name === 'TimeoutError' ? 'no answer in time' : 'cannot reach the Bot API', { aborted: !!signal?.aborted }); }
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!j.ok) throw fail(method, j.description || `HTTP ${r.status}`, { code: j.error_code, retryAfter: j.parameters?.retry_after });
  return j.result;
}

/** sendPhoto / sendDocument / sendVideo / sendAudio with the bytes attached. */
async function upload(method, params, { field, name, buffer, mime }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  form.append(field, new Blob([buffer], { type: mime || 'application/octet-stream' }), name);
  const r = await fetch(`${base()}/bot${token()}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) })
    .catch(() => { throw fail(method, 'cannot reach the Bot API'); });
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!j.ok) throw fail(method, j.description || `HTTP ${r.status}`);
  return j.result;
}

/** A file someone sent: its bytes and the name Telegram gave it. Bots may fetch up to 20 MB. */
async function download(fileId) {
  const f = await call('getFile', { file_id: fileId });
  const r = await fetch(`${base()}/file/bot${token()}/${f.file_path}`, { signal: AbortSignal.timeout(120000) })
    .catch(() => { throw fail('download', 'cannot reach the Bot API'); });
  if (!r.ok) throw fail('download', `HTTP ${r.status}`);
  return { buffer: Buffer.from(await r.arrayBuffer()), path: f.file_path };
}

module.exports = { call, upload, download, token, prefs };
