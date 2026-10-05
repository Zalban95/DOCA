#!/usr/bin/env node
'use strict';

/**
 * doca-client — this machine joins the hive (docs/design/hive.md §4; TODO H6.2, H6.6). Linux, macOS and Windows,
 * Node 22, no dependency. It pairs with a hub, asks its person once per tool family, and lends the granted ones —
 * `files`, `shell`, and screen, processes, apps and device (families.js) — to the hub's agents as an MCP server the
 * hub connects to (PROTOCOL.md §22, §22.1). Keep families.js beside this file.
 *
 *   doca-client pair https://hub:4242 641-598 [--name desk]     with a code from Settings → API Keys → Pair a device
 *   doca-client pair 'doca://pair?code=641598&host=hub:4242'      or the pairing link itself, in one step
 *   doca-client run [--grant files,shell] [--bind 100.x.y.z] [--port 18766]
 *   doca-client find                                            the hubs on this machine's tailnet
 *   doca-client update                                          the hub's copy of this client, checked, when it differs
 *   doca-client enable | disable | boot-status                     run by itself at boot (systemd user unit, launchd, Task Scheduler)
 *   doca-client status | forget
 *
 * Trust: a self-signed hub's certificate is pinned at pairing and is then the only one trusted (tlsFor), so it is
 * verified, not trusted blindly; a hub with a certificate the system trusts is verified as usual. The listener binds to the tailnet address (100.64.0.0/10) when there is one, else loopback, and answers
 * only with the bearer secret it offered the hub. The person decides what is lent; a family DOCA revokes is refused
 * from that moment. The hub's own copy of this lives in DOCA's clients/node.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const FAMILIES = ['files', 'shell', 'screen', 'processes', 'apps', 'device'];
const configDir = () => process.env.DOCA_CLIENT_DIR || (process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'doca-client') : path.join(os.homedir(), '.config', 'doca-client'));
const configFile = () => path.join(configDir(), 'config.json');
const load = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return null; } };
function save(c) { fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 }); fs.writeFileSync(configFile(), JSON.stringify(c, null, 2), { mode: 0o600 }); }
const say = (...a) => console.log(...a);

/* ── Talking to the hub (its certificate pinned) ── */
const pemOf = raw => `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

/**
 * TLS, three ways. Pairing (the one first contact, carrying only a one-time code) accepts the hub's certificate and
 * records it. After that a hub whose certificate the system trusts (a Tailscale one) is verified as usual, and a
 * self-signed hub is verified against exactly the certificate pinned at pairing — the only authority trusted, so a
 * different certificate fails the handshake before anything, the token included, is sent.
 */
function tlsFor(cfg, first) {
  if (first) return { rejectUnauthorized: false };
  if (cfg.pinPem) return { ca: cfg.pinPem, rejectUnauthorized: true, checkServerIdentity: () => undefined };
  return { rejectUnauthorized: true };
}

function request(cfg, method, p, body, { stream = false, signal, first = false } = {}) {
  const u = new URL(p, cfg.hub);
  const mod = u.protocol === 'https:' ? https : http;
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = mod.request(u, {
      signal, method, headers: { Accept: stream ? 'text/event-stream' : 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
      ...(u.protocol === 'https:' ? tlsFor(cfg, first) : {}),
    }, res => {
      if (first && res.socket.getPeerCertificate) {
        const cert = res.socket.getPeerCertificate();
        cfg._tls = { authorized: res.socket.authorized === true, pem: cert?.raw ? pemOf(cert.raw) : null, fp: cert?.fingerprint256 || null };
      }
      if (stream) return resolve(res);
      let raw = ''; res.on('data', d => { raw += d; });
      res.on('end', () => { let j = null; try { j = raw ? JSON.parse(raw) : null; } catch { j = { raw }; } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', e => reject(cfg.pinPem && /CERT|SELF_SIGNED|certificate/i.test(`${e.code} ${e.message}`)
      ? new Error(`The hub's certificate changed (pinned ${cfg.pinFp || 'at pairing'}). Pair again if that was expected.`) : e));
    if (data) req.write(data);
    req.end();
  });
}

/** The hub and code from the panel's pairing link (`doca://pair?code=641598&host=hub:4242`, its QR), or as given. */
function fromLink(hub, code) {
  const m = /^doca:\/\/pair\?(.+)$/.exec(String(hub || ''));
  if (!m) return { hub, code };
  const q = new URLSearchParams(m[1]);
  const digits = String(q.get('code') || '');
  return { hub: `https://${q.get('host')}`, code: digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits };
}

async function pair(hubOrLink, codeArg, { name = os.hostname() } = {}) {
  const { hub, code } = fromLink(hubOrLink, codeArg);
  if (!hub || !code) throw new Error('Pair with the link from the hub (doca://pair?…), or with its address and the code.');
  const cfg = { hub: hub.replace(/\/+$/, '') };
  const r = await request(cfg, 'POST', '/api/v1/devices/pair/complete', { code, name,
    caps: { formFactor: 'desktop', input: { text: true }, exec: ['shell'], ext: { client: 'doca-client', os: process.platform } } }, { first: true });
  if (r.status !== 201 && r.status !== 200) throw new Error(`Pairing failed (${r.status}): ${r.body?.error?.message || r.body?.error || 'unknown'}`);
  // A certificate the system already trusts is verified as usual; a self-signed one is pinned (tlsFor).
  const pin = cfg._tls && !cfg._tls.authorized ? { pinPem: cfg._tls.pem, pinFp: cfg._tls.fp } : {};
  const saved = { hub: cfg.hub, token: r.body.token, deviceId: r.body.device?.id, name, ...pin, grants: {}, secret: crypto.randomBytes(24).toString('hex'), pairedAt: new Date().toISOString() };
  save(saved);
  return saved;
}

/* ── The families it lends ── */
const homeOf = cfg => cfg.root || os.homedir();
function within(cfg, p) {
  const abs = path.resolve(homeOf(cfg), String(p || ''));
  const rel = path.relative(homeOf(cfg), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${abs} is outside what this machine shares (${homeOf(cfg)}).`);
  return abs;
}
const TOOLS = {
  files_list: { family: 'files', description: 'List a folder on this machine (empty path: the shared home).', input: { path: 'string' },
    run: (c, a) => { const dir = within(c, a.path); return { path: dir, entries: fs.readdirSync(dir, { withFileTypes: true }).map(e => { let st = {}; try { st = fs.statSync(path.join(dir, e.name)); } catch {} return { name: e.name, isDir: e.isDirectory(), size: st.size ?? 0, mtime: st.mtime?.toISOString?.() || null }; }) }; } },
  files_read: { family: 'files', description: 'Read a file on this machine (encoding "base64" for bytes).', input: { path: 'string', encoding: 'string' },
    run: (c, a) => { const f = within(c, a.path); const b = fs.readFileSync(f); const st = fs.statSync(f); return { content: a.encoding === 'base64' ? b.toString('base64') : b.toString('utf8'), size: st.size, mtime: st.mtime.toISOString() }; } },
  files_write: { family: 'files', description: 'Write a file on this machine.', input: { path: 'string', content: 'string', encoding: 'string' },
    run: (c, a) => { const f = within(c, a.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, a.encoding === 'base64' ? Buffer.from(a.content || '', 'base64') : String(a.content ?? '')); return { ok: true }; } },
  files_mkdir: { family: 'files', description: 'Make a folder on this machine.', input: { path: 'string' }, run: (c, a) => { fs.mkdirSync(within(c, a.path), { recursive: true }); return { ok: true }; } },
  files_move: { family: 'files', description: 'Move or rename on this machine.', input: { from: 'string', to: 'string' }, run: (c, a) => { fs.renameSync(within(c, a.from), within(c, a.to)); return { ok: true }; } },
  files_copy: { family: 'files', description: 'Copy on this machine.', input: { from: 'string', to: 'string' }, run: (c, a) => { fs.cpSync(within(c, a.from), within(c, a.to), { recursive: true }); return { ok: true }; } },
  files_delete: { family: 'files', description: 'Delete on this machine.', input: { paths: 'array' }, run: (c, a) => { for (const p of [].concat(a.paths || [])) fs.rmSync(within(c, p), { recursive: true, force: true }); return { ok: true }; } },
  shell_run: { family: 'shell', description: 'Run a command line on this machine (bash on Linux and macOS, PowerShell on Windows); returns its exit code and output.', input: { command: 'string', cwd: 'string', timeoutSec: 'number' },
    run: (c, a) => new Promise(resolve => {
      const win = process.platform === 'win32';
      const child = spawn(win ? 'powershell' : (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh'), win ? ['-NoProfile', '-NonInteractive', '-Command', a.command] : ['-c', a.command],
        { cwd: a.cwd ? within(c, a.cwd) : homeOf(c), windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => { stdout = (stdout + d).slice(-60000); }); child.stderr.on('data', d => { stderr = (stderr + d).slice(-20000); });
      const t = setTimeout(() => child.kill(), Math.min(600, Number(a.timeoutSec) || 120) * 1000);
      child.on('close', code => { clearTimeout(t); resolve({ code, stdout, stderr }); });
      child.on('error', e => { clearTimeout(t); resolve({ code: -1, stdout, stderr: e.message }); });
    }) },
};
Object.assign(TOOLS, require('./families')({ within }));   // screen, processes, apps, device (families.js)
const lent = cfg => Object.entries(TOOLS).filter(([, t]) => cfg.grants?.[t.family] === true && !(cfg.revoked || []).includes(t.family));

/** The MCP server the hub connects to: JSON-RPC over POST, the bearer secret required. */
function serve(cfg, { bind, port }) {
  const server = http.createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${cfg.secret}`) return reply(401, { error: 'unauthorized' });
    if (req.method !== 'POST') return reply(405, { error: 'POST JSON-RPC' });
    let raw = ''; req.on('data', d => { raw += d; if (raw.length > 30e6) req.destroy(); });
    req.on('end', async () => {
      let m; try { m = JSON.parse(raw); } catch { return reply(400, { error: 'not JSON' }); }
      if (m.id === undefined) return reply(202);
      const ok = result => reply(200, { jsonrpc: '2.0', id: m.id, result });
      if (m.method === 'initialize') return ok({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: `doca-client ${cfg.name}`, version: '1' } });
      if (m.method === 'ping') return ok({});
      if (m.method === 'tools/list') return ok({ tools: lent(cfg).map(([name, t]) => ({ name, description: t.description, inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(t.input).map(([k, ty]) => [k, { type: ty }])) } })) });
      if (m.method === 'tools/call') {
        const hit = lent(cfg).find(([name]) => name === m.params?.name);
        if (!hit) return ok({ content: [{ type: 'text', text: `${m.params?.name} is not lent by this machine (not granted, or revoked).` }], isError: true });
        try {
          const { image, ...rest } = (await hit[1].run(cfg, m.params.arguments || {})) || {};   // a picture is MCP image content
          return ok({ content: [...(image ? [{ type: 'image', data: image.data, mimeType: image.mimeType }] : []), { type: 'text', text: JSON.stringify(rest) }] });
        }
        catch (e) { return ok({ content: [{ type: 'text', text: e.message }], isError: true }); }
      }
      return reply(200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Unknown method ${m.method}` } });
    });
  });
  return new Promise(resolve => server.listen(port, bind, () => resolve(server)));
}

/** The address the hub reaches: the tailnet's (100.64.0.0/10) when this machine has one, else loopback. */
function tailnetAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)) return a.address;
  }
  return '127.0.0.1';
}

async function ask(question) {
  if (!process.stdin.isTTY) return false;
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise(r => rl.question(`${question} [y/N] `, r));
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

/** Follow the hub's events for device.control (refresh, ask, revoke, restore, disconnect) and acknowledge each. */
async function follow(cfg, { onEvent = () => {}, signal } = {}) {
  let since = 0;
  while (!signal?.aborted) {
    try {
      const res = await request(cfg, 'GET', `/api/v1/events?stream=1&since=${since}`, undefined, { stream: true, signal });
      let buf = '';
      await new Promise(resolve => {
        signal?.addEventListener('abort', () => { res.destroy(); resolve(); }, { once: true });
        res.on('data', async chunk => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
            if (!data) continue;
            let env; try { env = JSON.parse(data); } catch { continue; }
            if (env.seq) since = env.seq;
            await control(cfg, env).catch(() => {});
            onEvent(env);
          }
        });
        res.on('end', resolve); res.on('error', resolve);
      });
    } catch { /* the hub is restarting, or unreachable */ }
    if (!signal?.aborted) await new Promise(r => setTimeout(r, 3000));
  }
}

async function control(cfg, env) {
  if (env.type !== 'device.control') return;
  const { id, action, family } = env.payload || {};
  let detail = '';
  if (action === 'revoke' && family) { cfg.revoked = [...new Set([...(cfg.revoked || []), family])]; detail = `${family} withdrawn`; }
  if (action === 'restore' && family) { cfg.revoked = (cfg.revoked || []).filter(f => f !== family); detail = `${family} lent again`; }
  if (action === 'ask' && family && FAMILIES.includes(family)) {
    if (process.stdin.isTTY) { cfg.grants[family] = await ask(`The hub asks again: lend this machine's ${family} to its agents?`); detail = cfg.grants[family] ? 'granted' : 'refused'; }
    else detail = 'nobody at this machine to ask; unchanged';
  }
  if (action === 'refresh' || action === 'ask') await request(cfg, 'PUT', '/api/v1/devices/self/grants', { grants: cfg.grants });
  save(cfg);
  await request(cfg, 'POST', `/api/v1/devices/self/control/${encodeURIComponent(id)}/ack`, { ok: true, detail });
}

async function run({ grant = null, bind = null, port = 18766, root = null, signal } = {}) {
  const cfg = load();
  if (!cfg?.token) throw new Error('Not paired. Run: doca-client pair <hub> <code>');
  if (root) cfg.root = root;
  for (const f of FAMILIES) {
    if (grant) cfg.grants[f] = grant.includes(f);
    // With nobody at a terminal (at boot) an undecided family stays undecided — not lent, and asked next time someone is.
    else if (typeof cfg.grants[f] !== 'boolean' && process.stdin.isTTY) cfg.grants[f] = await ask(`Lend this machine's ${f} to the hive's agents?`);
  }
  save(cfg);
  const g = await request(cfg, 'PUT', '/api/v1/devices/self/grants', { grants: Object.fromEntries(FAMILIES.map(f => [f, cfg.grants[f] === true])) });
  if (g.status >= 400) throw new Error(`The hub refused the grants (${g.status}): ${JSON.stringify(g.body)}`);
  const addr = bind || tailnetAddress();
  const server = await serve(cfg, { bind: addr, port });
  const url = `http://${addr}:${server.address().port}/mcp`;
  const headers = { Authorization: `Bearer ${cfg.secret}` };
  const mine = await request(cfg, 'GET', '/api/v1/mcp/self');
  if (mine.status === 200) await request(cfg, 'PATCH', '/api/v1/mcp/self', { url, headers });
  else await request(cfg, 'POST', '/api/v1/mcp/offer', { label: `${cfg.name} (doca-client)`, url, headers, tools: lent(cfg).map(([n]) => n), note: `${process.platform} machine lending ${FAMILIES.filter(f => cfg.grants[f]).join(' and ') || 'nothing yet'}` });
  say(`✓ ${cfg.name} serves ${lent(cfg).length} tool(s) at ${url}${mine.status === 200 ? '' : ' — accept its offer in the hub (MCP tab) once'}.`);
  const stopped = new AbortController();
  if (signal) signal.addEventListener('abort', () => stopped.abort(), { once: true });
  follow(cfg, { signal: stopped.signal });
  /** Stop lending: the hub's stream and this listener close. */
  const stop = () => new Promise(resolve => { stopped.abort(); server.closeAllConnections?.(); server.close(() => resolve()); });
  return { server, url, cfg, stop };
}

/**
 * Update from the hub this client is paired with (TODO H6.5; api-v1/client-files.js): its manifest lists each file
 * with a sha256; what differs here is fetched as bytes over the pinned connection, checked against that sha256, and
 * only then written — the previous copy kept in the config folder. Returns what changed.
 */
async function update({ dir = __dirname } = {}) {
  const cfg = load();
  if (!cfg) throw new Error('Not paired: pair first, then update from that hub.');
  const m = await request(cfg, 'GET', '/api/v1/clients/node');
  if (m.status !== 200) throw new Error(`The hub has no client channel (${m.status}); it may be older than 2.191.0.`);
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const fetched = [];
  for (const f of m.body.files) {
    const here = path.join(dir, f.name);
    if (fs.existsSync(here) && sha(fs.readFileSync(here)) === f.sha256) continue;
    const res = await request(cfg, 'GET', `/api/v1/clients/node/${encodeURIComponent(f.name)}`, undefined, { stream: true });
    const bytes = Buffer.concat(await new Promise((resolve, reject) => { const parts = []; res.on('data', d => parts.push(d)); res.on('end', () => resolve(parts)); res.on('error', reject); }));
    if (res.statusCode !== 200 || sha(bytes) !== f.sha256) throw new Error(`${f.name} did not arrive intact; nothing was replaced.`);
    fetched.push({ name: f.name, bytes });
  }
  const keep = path.join(configDir(), 'previous');
  for (const f of fetched) {
    const here = path.join(dir, f.name);
    if (fs.existsSync(here)) { fs.mkdirSync(keep, { recursive: true }); fs.copyFileSync(here, path.join(keep, f.name)); }
    fs.writeFileSync(`${here}.new`, f.bytes);
    fs.renameSync(`${here}.new`, here);
  }
  return { version: m.body.version, changed: fetched.map(f => f.name) };
}

module.exports = { pair, fromLink, update, run, serve, load, request, TOOLS, FAMILIES, tailnetAddress, configFile };

if (require.main === module) {
  const [verb, ...rest] = process.argv.slice(2);
  const flag = n => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : null; };
  (async () => {
    if (verb === 'pair') { const c = await pair(rest[0], rest[1], { name: flag('name') || os.hostname() }); say(`✓ Paired with ${c.hub} as ${c.name} (${c.deviceId}). Next: doca-client run`); }
    else if (verb === 'run') { await run({ grant: flag('grant') ? flag('grant').split(',') : null, bind: flag('bind'), port: Number(flag('port')) || 18766 }); }
    else if (verb === 'find') {
      const hubs = await require('./discover').find();
      if (!hubs) say('Tailscale is not running here (or not installed), so there is no tailnet to look on. Pair with the hub\'s address instead.');
      else if (!hubs.length) say('No DOCA hub answers on the tailnet.');
      else for (const h of hubs) say(`${h.product} at ${h.url}${h.self ? ' (this machine)' : ''} — pair: doca-client pair ${h.url} <code from its Settings → API Keys>`);
    }
    else if (verb === 'update') { const u = await update(); say(u.changed.length ? `✓ Updated to the hub's ${u.version}: ${u.changed.join(', ')}. Restart run to use it.` : `✓ Already the hub's ${u.version}.`); }
    else if (['enable', 'disable', 'boot-status'].includes(verb)) {
      if (verb === 'enable' && !load()?.grants) throw new Error('Run it once by hand first (doca-client run), so its person can say what it lends; at boot it asks nothing.');
      const r = require('./boot').boot(verb === 'boot-status' ? 'status' : verb);
      say(`${r.ok ? '✓' : '✗'} ${r.method}: ${verb === 'enable' ? (r.ok ? 'doca-client run will start by itself' : r.out) : verb === 'disable' ? 'no longer starts by itself' : r.ok ? 'starts by itself' : 'does not start by itself'}${r.note ? `\n  ${r.note}` : ''}`);
    }
    else if (verb === 'status') { const c = load(); say(c ? JSON.stringify({ hub: c.hub, deviceId: c.deviceId, name: c.name, grants: c.grants, revoked: c.revoked || [] }, null, 2) : 'Not paired.'); }
    else if (verb === 'forget') { fs.rmSync(configFile(), { force: true }); say('Forgotten. (The hub still lists this device until you revoke it there.)'); }
    else say('usage: doca-client find | update | enable | disable | boot-status | pair <hub> <code> [--name N] | pair <doca://pair link> | run [--grant files,shell] [--bind IP] [--port N] | status | forget');
  })().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
}
