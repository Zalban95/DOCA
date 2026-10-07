# Sealed secrets — what DocaMobile and DocaDesk implement

> **Changed by the security review of 2026-10-07:** a secret with an `origin` is only ever a `field`;
> a field is filled only when it is a credential field and stays a secret afterwards; and for 60 s after any use the
> device refuses its read tools. DocaMobile 1.2.0 implemented the first version of this page — see "DocaMobile" below
> for what it must add.

The hub can now hand a device a password, a PIN or a key **for one use**, without the agent ever seeing it
(CONSTITUTION S4, TODO P1.3). The wire is PROTOCOL.md §22.3; the hub side is `modules/sealed/`, and the two clients in
this repository are worked examples: `clients/node/sealed.js` (a desktop: typing and the clipboard) and
`clients/browser/mcp.js` + `page.js` (a web page's field). Nothing here changes an existing route, scope or tool:
a client that does none of it keeps working, and the hub tells the agent that device's client is older.

## Both apps

1. **Take the seal key** once per pairing: `GET /api/v1/mcp/self/seal` with the device token (scope `mcp:self`, which
   the `phone` preset and DocaDesk's pairing already carry) → `{v, alg: "A256GCM", key, aad}`. Store `key` the way the
   token is stored — never in logs, backups or a crash report. A 404 means the hub has no sealed secrets: skip.
   A new pairing (a new device id) takes a new key.
2. **Handle `tools/call` for `secret_fill` on the MCP server the app already hosts, without listing it in
   `tools/list`.** Open `arguments.sealed` with AES-256-GCM: key = base64-decoded `key`, IV = base64 `iv` (12 bytes),
   input = base64 `data` (ciphertext ‖ 16-byte tag), additional data = UTF-8 of `aad`. A failure to open is a refusal:
   `isError`, "This was not sealed for this device: refused."
3. **Check before using**: `device` equals this device's id; `|now − iat| < 5 min`; `nonce` not seen in the last
   10 minutes (keep the seen nonces in memory). Refuse otherwise, with a sentence.
4. **Use it as `how` says** — or refuse what this device cannot do, in words the agent can act on. A payload with an
   `origin` is a secret that belongs to a site: use it only as a `field` on exactly that origin, and refuse `type` and
   `clipboard` for it (the hub already does; the device holds the line on its own).
5. **Hold your reads for 60 seconds after any use** (and while a secret is on the clipboard): refuse the read tools
   you lend — `shell`/`shell_job`, `files_read`, `screen_capture`, `screen_read`, `device_clipboard_read`, a WebView's
   page reads — with `isError` and a sentence ("A secret was just used on this device: screen_read waits 42 s more."). A
   value just typed, pasted or filled could otherwise be read straight back. The hub holds the same window on its side
   (`modules/sealed/hold.js`), but a device is not to rely on it.
6. **Answer** a text content block `{"done": "field"|"typed"|"clipboard", "uses": n, "counted": bool, "seconds": s}`.
   Never the value, in the answer, a log line, a toast, an analytics event or an exception message.
7. **Forget it**: drop every reference once used. Keep nothing on disk.

## DocaMobile (Android)

- `how: "field"` (always with `origin`: the hub sends it only for a secret that has its site) — through the
  accessibility service that already serves `screen_read` / `screen_press`: `ref` is the `[n]` of the node from the
  last `screen_read`. Fill with `ACTION_SET_TEXT` on that node only when it is editable and the foreground is a browser
  whose page origin is exactly `origin` — a look-alike gets nothing — **and only when the node is a password field**
  (`isPassword`, or its autofill hints name a password or a one-time code): a plain text field's value is in the next
  `screen_read`. Remember the filled node (its view id / window) as a secret until the window changes: `screen_read`
  never reports its text, even if the page turns it into a text field. A native app's field is `how: "type"` after
  the agent focused it — for a secret **without** an `origin` only.
- `how: "type"` — into the focused editable node (`findFocus(FOCUS_INPUT)`), `ACTION_SET_TEXT`; refuse when nothing
  editable has focus, and refuse a payload that carries an `origin`.
- `how: "clipboard"` — `ClipboardManager.setPrimaryClip` with `ClipDescription.extras` `android.content.extra.IS_SENSITIVE
  = true` (Android 13+: no preview, kept out of the keyboard's suggestions), then clear (`clearPrimaryClip`, API 28+)
  after `ttlSec`; Android cannot count pastes, so answer `counted: false`.
- While a secret is on the clipboard, and for 60 s after any `secret_fill`, refuse `device_clipboard_read`,
  `screen_read`, `screen_capture`, `files_read` and any command tool.
- The family is the one the person already lent for typing and the clipboard; a family revoked from the hub refuses
  `secret_fill` too.

## DocaDesk (Windows)

- `how: "type"` — `SendInput` with `KEYEVENTF_UNICODE` into the foreground window (the same path its input tools use).
- `how: "clipboard"` — set the text together with the formats `ExcludeClipboardContentFromMonitorProcessing`,
  `CanIncludeInClipboardHistory = 0` and `CanUploadToCloudClipboard = 0` (kept out of Win+V history and the cloud
  clipboard); clear after `ttlSec` if the clipboard still holds it (compare a hash); `counted: false`. Windows cannot
  count pastes reliably — a clipboard-format listener sees requests from clipboard managers too.
- `how: "field"` in its WebView2 — only when the WebView's document origin is exactly `origin`, and only into a
  credential field (password, or autocomplete `current-password` / `new-password` / `one-time-code`); fill through
  `ExecuteScriptAsync` with the value passed as a JSON-encoded argument (never concatenated into script text), the
  same native-setter-plus-`input`-event as `clients/browser/page.js fillSecret`.
- While a secret is on the clipboard, and for 60 s after any use, refuse its clipboard read, shell, file read and
  screen capture tools; refuse `type`/`clipboard` for a payload with an `origin`.

## Testing it against a hub

Pair with a test hub, take the key, accept the MCP offer, then in Field → Connectors keep a secret (any value) and
ask the agent to use it on the device (`secret_use {secret, device, mode}`): the person's approval appears, the
device does the use, and the panel's "Where they were used" lists it. `test/sealed-secrets.test.js` shows the hub's
side end to end, including opening the hub's seal with WebCrypto.
