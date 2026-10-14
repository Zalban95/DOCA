/* MCP → a server's token, in its own form (asked 2026-10-12: "no place to add the API key … if I paste it in the last
   space I still can't save"). A server that names a key for services (Home Assistant: `home-assistant`) gets one
   password field above its headers: what is pasted there is kept as that key, for the server's own address, when the
   form is saved — the secret's one home stays Keys for services (service-keys.js), never the server's headers. A token
   pasted into the headers as "Authorization: Bearer …" is taken the same way. The form opens under the row it edits. */

let _mcpKeyName = null;

/** Whether this hive keeps keys for services (feature service-keys): without them a server signs in by its own headers,
 *  and neither field is drawn (lib/licence.js: left out, never a control whose route is not there). */
const _mcpKeysOn = () => typeof licenceFeatureOn !== 'function' || licenceFeatureOn('service-keys');

/** Draw the token field for `key` (or remove it), saying whether one is kept already. */
async function mcpKeyField(key) {
  _mcpKeyName = key || null;
  document.getElementById('mcp-keyfield')?.remove();
  if (!key || !_mcpKeysOn()) { _mcpKeyName = null; return; }
  let kept = false;
  try { kept = ((await apiFetch('/api/connectors/keys/all')).keys || []).some(k => k.name === key); } catch { /* shown as not kept */ }
  const field = document.createElement('div');
  field.className = 'field';
  field.id = 'mcp-keyfield';
  field.innerHTML = `<div class="input-label">Token${infoBtn(`This server signs in with the key "${key}" from Field → Connectors → Keys for services. Paste the token here and Save: it is kept there, sent only to this server's address, and shown as dots afterwards. Leave it empty to keep the one there is.`)}</div>
    <input type="password" id="mcp-keyvalue" class="input" autocomplete="off" placeholder="${kept ? 'a token is kept — paste a new one to replace it' : 'paste the token here'}">
    <div class="input-label" style="text-transform:none;letter-spacing:0;color:${kept ? 'var(--green)' : 'var(--amber)'}">${kept ? `✓ A token is kept as "${escHtml(key)}".` : `No token yet: the server cannot connect until one is pasted.`}</div>`;
  const headers = document.getElementById('mcp-headers')?.closest('.field');
  const fold = headers?.closest('details') || headers;
  fold?.parentElement?.insertBefore(field, fold);
}

/** Before the server is saved: a pasted token (or a bearer header) becomes its key. Returns what was said. */
async function mcpKeyKeep() {
  if (!_mcpKeyName) return '';
  const box = document.getElementById('mcp-keyvalue'), hdr = document.getElementById('mcp-headers');
  let token = box?.value.trim() || '';
  const bearer = /^\s*Authorization:\s*Bearer\s+(\S+)\s*$/im.exec(hdr?.value || '');
  if (!token && bearer && !/^•+$/.test(bearer[1])) token = bearer[1];
  if (!token) return '';
  const url = document.getElementById('mcp-url').value.trim();
  let origin; try { origin = new URL(url).origin; } catch { throw new Error('Give the server\'s URL first: the token is sent only to that address.'); }
  await apiFetch('/api/connectors/keys/all', { method: 'POST', body: { name: _mcpKeyName, origin, key: token, note: document.getElementById('mcp-name').value.trim() } });
  if (bearer) hdr.value = hdr.value.replace(bearer[0], '').trim();   // its one home is the key now
  if (box) box.value = '';
  return ` — the token is kept as "${_mcpKeyName}"`;
}

/** The form under the row it edits (a new server: back in its own place), and in view. */
function mcpFormPlace(id) {
  const form = document.getElementById('mcp-form');
  if (!form) return;
  if (!form._home) form._home = { parent: form.parentElement, next: form.nextSibling };
  const card = id && document.getElementById(`mcp-status-${id}`)?.closest('.mcp-card');
  if (card) card.after(form);
  else form._home.parent.insertBefore(form, form._home.next);
  requestAnimationFrame(() => form.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

/** Before the list is drawn again the form goes home (it would be wiped with the rows), and back under its row after. */
function mcpFormHome() {
  const form = document.getElementById('mcp-form');
  if (form?._home && form.parentElement !== form._home.parent) form._home.parent.insertBefore(form, form._home.next);
}
function mcpFormBack() {
  const form = document.getElementById('mcp-form'), id = document.getElementById('mcp-name')?.dataset.editing;
  const card = id && form?.style.display !== 'none' && document.getElementById(`mcp-status-${id}`)?.closest('.mcp-card');
  if (card) card.after(form);
}

/* A command server's secrets as keys for services (modules/mcp/key-env.js): NAME=key lines beside its environment, the
   hub filling each variable from the key as it starts the server — so the value lives in Keys for services, not here. */
function mcpKeyEnvField(map) {
  let box = document.getElementById('mcp-keyenv');
  if (!_mcpKeysOn()) { box?.closest('.field')?.remove(); return; }
  if (!box) {
    const env = document.getElementById('mcp-env')?.closest('.field');
    if (!env) return;
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<div class="input-label">Environment from keys for services${infoBtn('One NAME=key per line: the variable NAME is set, as the server starts, to the key of that name in Field → Connectors → Keys for services. The token is kept there, never with the server. Empty by default.')}</div>
      <textarea id="mcp-keyenv" class="input" rows="2" placeholder="GITHUB_TOKEN=github" data-default=""></textarea>`;
    env.after(field);
    box = document.getElementById('mcp-keyenv');
  }
  box.value = Object.entries(map || {}).map(([k, v]) => `${k}=${v}`).join('\n');
}
/** What the field says, as the server's keyEnv ('' takes it off); undefined while the field is not drawn. */
function mcpKeyEnvRead() { const box = document.getElementById('mcp-keyenv'); return box ? box.value : undefined; }
