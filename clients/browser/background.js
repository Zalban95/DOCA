/* DOCA in this browser — the extension's background (TODO H5.5). It pairs with a hub like any client, then dials the
   hub's socket (wss://<hub>/api/v1/mcp/host) and is an MCP server on it (mcp.js), offering itself once so a person
   accepts it in the MCP tab. Chrome, Edge, Brave and Firefox (Manifest V3): a service worker where there is one,
   a background script where there is not. */
if (typeof importScripts === 'function' && !globalThis.__docaMcp) importScripts('page.js', 'mcp.js');
const ext = globalThis.browser || globalThis.chrome;

const KEEPALIVE_MS = 20000;   // a message every 20 s keeps an MV3 service worker (and its socket) alive
let ws = null, retry = 1000, keep = null;

const load = async () => (await ext.storage.local.get('doca')).doca || {};
const store = async patch => { const s = { ...(await load()), ...patch }; await ext.storage.local.set({ doca: s }); return s; };
const badge = on => { try { ext.action.setBadgeText({ text: on ? '●' : '' }); ext.action.setBadgeBackgroundColor({ color: on ? '#57c9c2' : '#888' }); } catch { /* no badge */ } };
const wsUrl = hub => `${hub.replace(/^http/, 'ws')}/api/v1/mcp/host`;

/** The browser, as mcp.js uses it. */
const env = {
  tabs: async () => (await ext.tabs.query({})).map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active && t.highlighted !== false })),
  tab: async id => { try { const t = await ext.tabs.get(id); return { id: t.id, title: t.title, url: t.url, active: t.active }; } catch { return null; } },
  allowed: async url => { try { return /^https?:/.test(url) && await ext.permissions.contains({ origins: [`${new URL(url).origin}/*`] }); } catch { return false; } },
  open: url => new Promise(resolve => {
    ext.tabs.create({ url, active: false }).then(t => {
      const done = () => { ext.tabs.onUpdated.removeListener(on); ext.tabs.get(t.id).then(x => resolve({ id: x.id, url: x.url }), () => resolve({ id: t.id, url })); };
      const on = (id, info) => { if (id === t.id && info.status === 'complete') done(); };
      ext.tabs.onUpdated.addListener(on);
      setTimeout(done, 15000);
    });
  }),
  page: async (tabId, fn, ...args) => {
    await ext.scripting.executeScript({ target: { tabId }, files: ['page.js'] });
    const [r] = await ext.scripting.executeScript({ target: { tabId }, func: (f, a) => globalThis.__docaPage[f](...a), args: [fn, args] });
    return r && r.result;
  },
  screenshot: async tabId => { const t = await ext.tabs.get(tabId); return (await ext.tabs.captureVisibleTab(t.windowId, { format: 'png' })).replace(/^data:image\/png;base64,/, ''); },
  back: tabId => ext.tabs.goBack(tabId),
};

async function connect() {
  const s = await load();
  if (!s.token || !s.hub || (ws && ws.readyState <= 1)) return;
  ws = new WebSocket(`${wsUrl(s.hub)}?access_token=${encodeURIComponent(s.token)}`);
  ws.onopen = async () => {
    retry = 1000; badge(true);
    clearInterval(keep); keep = setInterval(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/keepalive' })); }, KEEPALIVE_MS);
    if (!s.offered) offer(s).catch(e => store({ lastError: `Offering it to the hub: ${e.message}` }));
    await store({ connected: true, lastError: null });
  };
  ws.onmessage = async ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    const reply = await globalThis.__docaMcp.handle(env, msg, !!(await load()).paused);
    if (reply && ws && ws.readyState === 1) ws.send(JSON.stringify(reply));
  };
  ws.onclose = async ev => {
    badge(false); clearInterval(keep); ws = null;
    await store({ connected: false, ...(ev.code === 1006 ? { lastError: 'Cannot reach the hub. If it has a self-signed certificate, open its address in this browser once and accept it.' } : {}) });
    setTimeout(connect, retry); retry = Math.min(retry * 2, 60000);
  };
}

/** Offer this browser's tools to the hub once; a person accepts it in DOCA's MCP tab. */
async function offer(s) {
  const r = await fetch(`${s.hub}/api/v1/mcp/offer`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transport: 'socket', label: s.name, tools: globalThis.__docaMcp.TOOLS.map(t => t.name),
      note: 'This browser, through the DOCA extension: only the sites its person allows, with their sign-ins.' }) });
  if (r.status !== 202) throw new Error(`HTTP ${r.status}`);
  await store({ offered: true });
}

/** Pair with a code from the hub (Settings → API Keys, preset "browser"), or a doca://pair link. */
async function pair({ hub, code, name }) {
  const link = /^doca:\/\/pair\?(.+)$/.exec(String(hub || '').trim());
  if (link) { const q = new URLSearchParams(link[1]); hub = `https://${q.get('host')}`; const d = String(q.get('code') || ''); code = d.length === 6 ? `${d.slice(0, 3)}-${d.slice(3)}` : d; }
  hub = String(hub || '').trim().replace(/\/+$/, '');
  const r = await fetch(`${hub}/api/v1/devices/pair/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(code || '').trim(), name, caps: { formFactor: 'desktop', input: { text: true }, ext: { client: 'doca-browser' } } }) });
  const body = await r.json().catch(() => ({}));
  if (r.status !== 200 && r.status !== 201) throw new Error(body.error?.message || `HTTP ${r.status}`);
  await store({ hub, token: body.token, deviceId: body.device?.id, name, offered: false, pairedAt: new Date().toISOString() });
  connect();
  return { ok: true };
}

ext.runtime.onMessage.addListener((m, _sender, reply) => {
  (async () => {
    if (m.type === 'pair') return pair(m);
    if (m.type === 'pause') return store({ paused: !!m.on });
    if (m.type === 'forget') { try { ws && ws.close(); } catch { /* closed */ } await ext.storage.local.remove('doca'); badge(false); return { ok: true }; }
    if (m.type === 'reconnect') { connect(); return { ok: true }; }
    const s = await load();
    return { paired: !!s.token, hub: s.hub, name: s.name, connected: !!(ws && ws.readyState === 1), paused: !!s.paused, lastError: s.lastError || null };
  })().then(reply, e => reply({ error: e.message }));
  return true;   // answered asynchronously
});

ext.alarms.create('doca-reconnect', { periodInMinutes: 1 });
ext.alarms.onAlarm.addListener(a => { if (a.name === 'doca-reconnect') connect(); });
ext.runtime.onStartup.addListener(connect);
connect();
