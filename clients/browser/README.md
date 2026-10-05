# DOCA in this browser

A browser extension that lets your DOCA hive use **the sites you allow, in your own browser, with your sign-ins**
(TODO H5.5). It works in Chrome, Edge, Brave and other Chromium browsers, and in Firefox 121 or later (Manifest V3).

## Install

1. In DOCA: Settings → API Keys → pair a device, role **extension**, and download the extension from the link
   beside it (or `GET /api/v1/clients/browser.zip`). Unzip it.
2. Chrome / Edge / Brave: Extensions → Developer mode → **Load unpacked** → the `doca-browser` folder.
   Firefox: `about:debugging` → This Firefox → **Load Temporary Add-on** → `manifest.json` (a signed build is for later).
3. Click the DOCA button in the toolbar, paste the pairing link (or the hub's address and the code) and **Pair**.
   The browser asks once whether the extension may reach your hub.
4. In DOCA's MCP tab, **Accept** the browser's offer. Its tools are the agent's while the browser is open.

If your hub uses its own self-signed certificate, open its address in this browser once and accept the certificate
first — or give the hub a real one (`tailscale cert`), which every browser trusts.

## What it lets DOCA do — and not

- **Only sites you allow.** On any page, the toolbar button → "Let DOCA use this site" asks the browser's own
  permission for that site; "Remove" takes it back. Nothing is allowed at install.
- Tools: `browser_tabs`, `browser_open` (an allowed site, in a background tab), `browser_snapshot` (read a page,
  controls numbered), `browser_click`, `browser_type`, `browser_screenshot` (the tab in front), `browser_back`.
- **It never types a password or a card number**, and never reads one back. You sign in yourself.
- **A control that pays, buys, signs in, confirms or submits a form holding a secret is refused** unless the call
  says `confirm: true` — and the hub then always asks you, in every approval mode.
- What it reads from a page reaches the agent marked as other people's words, never as instructions.
- While DOCA uses a page a strip across its top says so. **Pause** in the popup stops it at once.

## How it connects

It cannot listen on a port, so it dials the hub: a WebSocket to `/api/v1/mcp/host` with its token, on which it is
an MCP server (PROTOCOL.md §22.2). `page.js` is what runs in a page, `mcp.js` the tools, `background.js` the browser
glue; `test/browser-extension.test.js` runs the tools against a fake browser.
