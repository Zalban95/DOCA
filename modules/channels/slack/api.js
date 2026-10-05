'use strict';

/**
 * The Slack Web API, as much of it as the channel uses, and Socket Mode's connection URL. Two tokens, both a
 * host's: the app-level token (`xapp-…`, scope connections:write) opens the socket; the bot token (`xoxb-…`)
 * posts, updates and fetches files. Prefs `channels.slack.appToken` / `.botToken`, or SLACK_APP_TOKEN /
 * SLACK_BOT_TOKEN; sent as headers, never in a URL or an error. `channels.slack.apiBase` / DOCA_SLACK_API
 * point it at the tests' stub.
 */
const prefs = () => require('../../utils').loadPrefs().channels?.slack || {};
const base = () => String(process.env.DOCA_SLACK_API || prefs().apiBase || 'https://slack.com/api').replace(/\/+$/, '');
const appToken = () => String(process.env.SLACK_APP_TOKEN || prefs().appToken || '');
const botToken = () => String(process.env.SLACK_BOT_TOKEN || prefs().botToken || '');

const fail = (method, why, extra = {}) => Object.assign(new Error(`Slack ${method}: ${why}`), { status: 502, ...extra });

async function call(method, params = {}, { token = botToken(), timeoutMs = 30000, form = null } = {}) {
  if (!token) throw fail(method, 'no token (Settings → Channels)', { status: 409 });
  let r;
  try {
    r = await fetch(`${base()}/${method}`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, ...(form ? {} : { 'Content-Type': 'application/json; charset=utf-8' }) },
      body: form || JSON.stringify(params) });
  } catch (e) { throw fail(method, e.name === 'TimeoutError' ? 'no answer in time' : 'cannot reach Slack'); }
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!j.ok) throw fail(method, j.error || `HTTP ${r.status}`, { retryAfter: Number(r.headers.get('retry-after')) || undefined });
  return j;
}

/** Socket Mode: a fresh wss:// address for one connection. */
const socketUrl = async () => (await call('apps.connections.open', {}, { token: appToken() })).url;

/** A file uploaded and shared into a channel: Slack's two-step external upload. */
async function upload(channel, { buffer, name, mime }) {
  const form = new URLSearchParams({ filename: name, length: String(buffer.length) });
  const { upload_url, file_id } = await call('files.getUploadURLExternal', null, { form });
  const r = await fetch(upload_url, { method: 'POST', body: buffer, headers: { 'Content-Type': mime || 'application/octet-stream' }, signal: AbortSignal.timeout(120000) })
    .catch(() => { throw fail('upload', 'cannot reach Slack'); });
  if (!r.ok) throw fail('upload', `HTTP ${r.status}`);
  return call('files.completeUploadExternal', { files: [{ id: file_id, title: name }], channel_id: channel });
}

/** A file someone sent (`url_private`), fetched with the bot token. */
async function download(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${botToken()}` }, signal: AbortSignal.timeout(120000) })
    .catch(() => { throw fail('download', 'cannot reach Slack'); });
  if (!r.ok) throw fail('download', `HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { call, socketUrl, upload, download, appToken, botToken, prefs };
