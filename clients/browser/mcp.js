/* DOCA in this browser — the MCP server it is on the socket it opens to the hub (TODO H5.5; the hub's side is
   modules/mcp/socket-hosts.js). Written against a small `env` (background.js gives it the browser's; the tests a fake),
   so what the tools do and refuse is checked without a browser:

     env.tabs() → [{id, title, url, active}]   env.tab(id) → tab | null        env.allowed(url) → was this site allowed?
     env.open(url) → tab                       env.page(tabId, fn, ...args) → what page.js's fn returned
     env.screenshot(tabId) → base64 PNG         env.back(tabId)

   Every tool that touches a page works only on a site the person allowed in the extension (the browser's own
   per-site permission); a tool that reads a page says so (openWorldHint), and the hub frames what it returns as other
   people's words. */
(function (root) {
  const VERSION = '1';
  const text = t => ({ content: [{ type: 'text', text: String(t) }] });
  const fail = t => ({ content: [{ type: 'text', text: String(t) }], isError: true });
  const origin = url => { try { return new URL(url).origin; } catch { return String(url); } };
  const notAllowed = url => `${origin(url)} is not a site the person let DOCA use. Ask them to open it and allow it in the DOCA extension (its button in the toolbar → "Let DOCA use this site").`;
  const TAB = { tab: { type: 'number', description: 'A tab id from browser_tabs; omitted: the tab in front.' } };

  const TOOLS = [
    { name: 'browser_tabs', description: 'The tabs open in the person\'s own browser: id, title, address, and whether DOCA may use that site.',
      inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'browser_open', description: 'Open an address in a new tab of the person\'s own browser (their sign-ins apply). Only on a site they allowed.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    { name: 'browser_snapshot', description: 'Read a page in the person\'s browser: title, address, every visible control numbered [n], and its text. Click or type by those numbers.',
      inputSchema: { type: 'object', properties: { ...TAB } }, annotations: { readOnlyHint: true, openWorldHint: true } },
    { name: 'browser_click', description: 'Click [ref] from the last browser_snapshot. A control that pays, buys, signs in or submits needs confirm: true (the person is asked).',
      inputSchema: { type: 'object', properties: { ...TAB, ref: { type: 'number' }, confirm: { type: 'boolean' } }, required: ['ref'] } },
    { name: 'browser_type', description: 'Type into field [ref] from the last browser_snapshot; submit sends the form. Never a password or card field: the person signs in themselves.',
      inputSchema: { type: 'object', properties: { ...TAB, ref: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' }, confirm: { type: 'boolean' } }, required: ['ref', 'text'] } },
    { name: 'browser_screenshot', description: 'A picture of the tab in front, as the person sees it.',
      inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: true } },
    { name: 'browser_back', description: 'Go back one page in a tab.', inputSchema: { type: 'object', properties: { ...TAB } } },
  ];

  /** The tab a call is about, refused unless its site is allowed. */
  async function tabFor(env, a) {
    const tab = a.tab != null ? await env.tab(Number(a.tab)) : (await env.tabs()).find(t => t.active);
    if (!tab) return { error: a.tab != null ? `No tab ${a.tab}: browser_tabs lists them.` : 'No tab is in front.' };
    if (!(await env.allowed(tab.url))) return { error: notAllowed(tab.url) };
    return { tab };
  }

  const RUN = {
    async browser_tabs(env) {
      const tabs = await env.tabs();
      const rows = await Promise.all(tabs.map(async t => `${t.id}${t.active ? ' (in front)' : ''}  ${(await env.allowed(t.url)) ? 'allowed' : 'not allowed'}  ${t.title || ''} — ${t.url || ''}`));
      return text(rows.join('\n') || 'No tabs.');
    },
    async browser_open(env, a) {
      if (!/^https?:\/\//.test(String(a.url || ''))) return fail('An http(s) address.');
      if (!(await env.allowed(a.url))) return fail(notAllowed(a.url));
      const t = await env.open(String(a.url));
      return text(`Opened tab ${t.id}: ${t.url || a.url}. browser_snapshot {tab: ${t.id}} reads it.`);
    },
    async browser_snapshot(env, a) {
      const { tab, error } = await tabFor(env, a);
      if (error) return fail(error);
      await env.page(tab.id, 'mark', 'reading');
      return text(await env.page(tab.id, 'snapshot'));
    },
    async browser_click(env, a) {
      const { tab, error } = await tabFor(env, a);
      if (error) return fail(error);
      await env.page(tab.id, 'mark', `clicking [${a.ref}]`);
      const r = await env.page(tab.id, 'click', a.ref, a.confirm === true);
      return r && r.ok ? text(r.text) : fail(r ? r.error : 'The page did not answer.');
    },
    async browser_type(env, a) {
      const { tab, error } = await tabFor(env, a);
      if (error) return fail(error);
      await env.page(tab.id, 'mark', `typing into [${a.ref}]`);
      const r = await env.page(tab.id, 'type', a.ref, String(a.text ?? ''), a.submit === true, a.confirm === true);
      return r && r.ok ? text(r.text) : fail(r ? r.error : 'The page did not answer.');
    },
    async browser_screenshot(env) {
      const { tab, error } = await tabFor(env, {});
      if (error) return fail(error);
      return { content: [{ type: 'image', mimeType: 'image/png', data: await env.screenshot(tab.id) }] };
    },
    async browser_back(env, a) {
      const { tab, error } = await tabFor(env, a);
      if (error) return fail(error);
      await env.back(tab.id);
      return text(`Went back in tab ${tab.id}.`);
    },
  };

  /** One JSON-RPC message from the hub → the answer to send back, or null for a notification. */
  async function handle(env, msg, paused = false) {
    if (!msg || msg.id === undefined) return null;
    const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') return ok({ protocolVersion: '2025-03-26', serverInfo: { name: 'doca-browser', version: VERSION }, capabilities: { tools: { listChanged: false } } });
    if (msg.method === 'ping') return ok({});
    if (msg.method === 'tools/list') return ok({ tools: TOOLS });
    if (msg.method === 'tools/call') {
      const name = msg.params && msg.params.name, args = (msg.params && msg.params.arguments) || {};
      if (paused) return ok(fail('The person paused DOCA in this browser.'));
      if (!RUN[name]) return ok(fail(`No tool ${name}.`));
      try { return ok(await RUN[name](env, args)); } catch (e) { return ok(fail(e && e.message || String(e))); }
    }
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${msg.method} is not supported` } };
  }

  const api = { TOOLS, handle, VERSION };
  root.__docaMcp = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
