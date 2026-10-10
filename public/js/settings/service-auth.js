/* Field → Connectors → API services: how a service is signed in to (asked 2026-10-10: "advanced drop-down options to
   add all that's needed for this or future more complex services … space for the 2 API parts (id and secret)").
   Every kind there is, in one select under Advanced — none, a key in a header or the query, a bearer token, a user and
   password, an id and a secret traded for a token (hi3d.ai's), OAuth 2.0 client credentials with a scope — and the two
   that are not a key pasted here: a sign-in page (a connector) and a client certificate (not yet). An id and a secret
   are typed into two boxes and kept exactly as before, joined as id:secret (modules/service-keys.js). */
const SVC_SIGNIN = [
  ['bearer', 'a token: Authorization: Bearer'], ['header', 'a key in another header'], ['query', 'a key in the address (?param=)'],
  ['basic', 'a user and a password (Basic)'], ['exchange', 'an id and a secret, traded for a token'], ['client', 'OAuth 2.0 client credentials (with a scope)'],
  ['none', 'nothing — my own server (this machine, the LAN, the tailnet)'], ['connector', 'a sign-in page (OAuth) — set up as a connector'],
  ['mtls', 'a client certificate (mutual TLS) — not yet'],
];
const SVC_TWO = { exchange: ['Access key / client id', 'Secret key / client secret'], client: ['Client id', 'Client secret'], basic: ['User', 'Password'] };

/** The sign-in fields of the Advanced fold. */
function serviceAuthFieldsHtml() {
  return `<div class="svc-field-grid">
    <label class="svc-field"><span>How it signs in</span><select class="input" id="sk-place" data-default="bearer" data-label="How it signs in" onchange="serviceKeysPlace()">
      ${SVC_SIGNIN.map(([v, l]) => `<option value="${v}"${v === 'mtls' ? ' disabled' : ''}>${escHtml(l)}</option>`).join('')}</select></label>
    <label class="svc-field" data-for="header query"><span>Header or parameter</span><input class="input" id="sk-field" data-default="" data-label="Header or parameter" placeholder="X-API-Key, api_key"></label>
    <label class="svc-field" data-for="header"><span>Before the key</span><input class="input" id="sk-prefix" data-default="" data-label="Before the key" placeholder="Token "></label>
    <label class="svc-field" data-for="exchange client"><span>Token address</span><input class="input" id="sk-tokenurl" data-default="" data-label="Token address" placeholder="https://api.example.com/oauth/token"></label>
    <label class="svc-field" data-for="client"><span>Scope</span><input class="input" id="sk-scope" data-default="" data-label="Scope" placeholder="read write (empty: the service's default)"></label>
    <label class="svc-field"><span>Who may use it</span><select class="input" id="sk-who" data-default="host" data-label="Who may use it"><option value="host">admins' turns</option><option value="everyone">everyone</option></select></label>
  </div>
  <div class="desc svc-auth-note" id="sk-auth-note" hidden></div>
  <div class="svc-field-grid">
    <label class="svc-field svc-wide"><span>Extra headers — one <code>Name: value</code> a line, sent with every request (never the key)</span>
      <textarea class="input" id="sk-headers" data-default="" data-label="Extra headers" rows="2" spellcheck="false" placeholder="X-Client: doca"></textarea></label>
    <label class="svc-field"><span>Rate limit (requests a minute)</span><input class="input" id="sk-rate" type="number" min="0" data-default="" data-label="Rate limit" placeholder="no limit"></label>
    <label class="svc-field"><span>Its docs</span><input class="input" id="sk-docs" data-default="" data-label="Its docs" placeholder="https://docs.example.com"></label>
  </div>`;
}

/** The key's boxes in the main row: one key, or two (an id and a secret; a user and a password) — joined as before. */
function serviceKeyBoxesHtml() {
  return `<input class="input" id="sk-key" type="password" autocomplete="new-password" placeholder="the key" style="flex:1;min-width:150px">
    <input class="input" id="sk-id" autocomplete="off" placeholder="Access key / client id" style="flex:1;min-width:150px" hidden>
    <input class="input" id="sk-secret" type="password" autocomplete="new-password" placeholder="Secret key / client secret" style="flex:1;min-width:150px" hidden>`;
}

/** Show the fields that mean something for this way of signing in. */
function serviceKeysPlace() {
  const how = document.getElementById('sk-place')?.value || 'bearer';
  document.querySelectorAll('#service-keys-card .svc-field[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(how); });
  const two = SVC_TWO[how], key = document.getElementById('sk-key'), id = document.getElementById('sk-id'), sec = document.getElementById('sk-secret');
  if (!key) return;
  key.hidden = !!two || ['none', 'connector', 'mtls'].includes(how);
  id.hidden = sec.hidden = !two;
  const hint = _svcForm.keyHint ? ` — ${_svcForm.keyHint}` : '';
  if (two) { id.placeholder = two[0]; sec.placeholder = two[1]; id.title = sec.title = `${two[0]} and ${two[1]}${hint}`; }
  key.placeholder = _svcForm.hasKey ? 'kept — paste to replace' : `the key${hint ? hint.slice(0, 60) : ''}`;
  if (two && _svcForm.hasKey) { id.placeholder = `${two[0]} (kept)`; sec.placeholder = `${two[1]} (kept)`; }
  const note = document.getElementById('sk-auth-note');
  if (note) {
    note.hidden = !['connector', 'none'].includes(how);
    note.innerHTML = how === 'connector'
      ? 'A service you sign in to on its own page (Google, GitHub, Microsoft or any OAuth 2.0 service) is a connector: its client id and secret go in the connector form above, and Connect opens its page. <button class="btn btn-xs" onclick="document.querySelector(\'#sp-connectors .card\')?.scrollIntoView({block:\'start\'})">Go to the connectors</button>'
      : 'No key: only for an address of your own — this machine, the local network or the tailnet.';
  }
}

/** How the key is sent, from the fold's fields (a definition's `auth`). */
function serviceAuthOf() {
  const v = id => (document.getElementById(id)?.value || '').trim(), how = v('sk-place');
  if (how === 'header') return { type: 'apiKey', in: 'header', name: v('sk-field') || 'Authorization', ...(v('sk-prefix') ? { prefix: document.getElementById('sk-prefix').value } : {}) };
  if (how === 'query') return { type: 'apiKey', in: 'query', name: v('sk-field') || 'api_key' };
  if (how === 'basic') return { type: 'basic' };
  if (how === 'exchange') return { type: 'oauth2', tokenUrl: v('sk-tokenurl'), tokenBody: 'json' };
  if (how === 'client') return { type: 'oauth2', tokenUrl: v('sk-tokenurl'), tokenBody: 'form', ...(v('sk-scope') ? { scope: v('sk-scope') } : {}) };
  if (how === 'none') return { type: 'none' };
  return { type: 'bearer' };
}

/** A definition's `auth` into the fold's fields. */
function serviceAuthFill(a = { type: 'bearer' }) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  const how = a.type === 'apiKey' ? (a.in === 'query' ? 'query' : 'header') : a.type === 'oauth2' ? (a.tokenBody === 'json' ? 'exchange' : 'client') : ['basic', 'none'].includes(a.type) ? a.type : 'bearer';
  set('sk-place', how);
  set('sk-field', a.type === 'apiKey' ? a.name : '');
  set('sk-prefix', a.prefix || '');
  set('sk-tokenurl', a.type === 'oauth2' ? a.tokenUrl : '');
  set('sk-scope', a.scope || '');
}

/** The key as it is kept: the one box, or the two joined id:secret. `null` when nothing was typed; an Error to ask for. */
function serviceKeyTyped() {
  const how = document.getElementById('sk-place')?.value;
  if (!SVC_TWO[how]) return document.getElementById('sk-key').value || null;
  const id = document.getElementById('sk-id').value.trim(), sec = document.getElementById('sk-secret').value.trim();
  if (!id && !sec) return null;
  if (!id || !sec) return Object.assign(new Error(`Both: the ${(id ? SVC_TWO[how][1] : SVC_TWO[how][0]).toLowerCase()} too.`), { field: id ? 'sk-secret' : 'sk-id' });
  if (id.includes(':')) return Object.assign(new Error(`The ${SVC_TWO[how][0].toLowerCase()} has no colon in it.`), { field: 'sk-id' });
  return `${id}:${sec}`;
}

/** "Name: value" lines ↔ an object. */
function serviceHeadersOf(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) { const m = /^\s*([A-Za-z0-9-]{1,60})\s*:\s*(.*?)\s*$/.exec(line); if (m) out[m[1]] = m[2]; }
  return Object.keys(out).length ? out : null;
}
const serviceHeadersText = h => Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
