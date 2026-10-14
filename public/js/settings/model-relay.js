/* Field → API keys → Model relay (modules/relay): the owner's switch for the hub's OpenAI-compatible relay, which lets
   programs inside an agents' computer use this hub's models without a provider key going into it — on or off, who it is
   available for, which models it offers, and where its own small listener sits. A host's; each computer's own switch is
   on its card in the Computers tab (computers-relay.js). */
async function modelRelayRender() {
  const panel = document.querySelector('#sp-keys .scroll-y') || document.getElementById('sp-keys');
  if (!panel || (typeof _settingsNoHost !== 'undefined' && _settingsNoHost)) return;
  let card = document.getElementById('model-relay-card');
  if (!card) { card = Object.assign(document.createElement('div'), { className: 'card', id: 'model-relay-card' }); panel.append(card); }
  let s;
  try { s = await apiFetch('/api/computers/relay'); } catch (e) { card.innerHTML = `<div class="card-title">Model relay</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const where = s.listening ? `Listening on ${escHtml(s.listening.address)}:${s.listening.port} — inside a computer: <code>${escHtml(s.listening.url)}</code>`
    : s.enabled ? `Not listening: ${escHtml(s.reason || 'unknown')}.` : 'Off: nothing answers.';
  const def = (s.offered || []).map(e => `${e.provider}/${e.model}`).join('\n');
  card.innerHTML = `<div class="card-title">Model relay</div>
    <p class="desc" style="margin-bottom:8px">Programs inside an agents' computer use this hub's models through it — an OpenAI-compatible address and a token of the computer's own — and the provider's key never leaves the hub. What they spend counts for the computer's person, within their budget and the models allotted to them.</p>
    <label class="mr-switch" style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="switch" id="mr-enabled" data-default="false"${s.enabled ? ' checked' : ''}> Answer requests through the relay</label>
    <div class="form-row" style="margin-top:8px"><span class="tool-label">Available for</span>
      <label style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><input type="checkbox" id="mr-computers" data-default="true"${s.computers ? ' checked' : ''}> Agents' computers${infoBtn('Each computer also has its own switch, on its card in the Computers tab (or the computer tool\'s relay action): only those switched on are answered.')}</label>
      <label style="display:inline-flex;gap:6px;align-items:center;opacity:.6" title="${escHtml(s.devicesNote)}"><input type="checkbox" id="mr-devices" disabled> Paired devices</label>
      <div class="desc" style="font-size:11px;color:var(--muted)">${escHtml(s.devicesNote)}</div></div>
    <div class="form-row"><span class="tool-label">Models${infoBtn('One per line, as provider/model. Empty: the harness\'s own model and its fallbacks.')}</span>
      <textarea class="input" id="mr-models" rows="3" data-default="" placeholder="${escHtml(def || 'provider/model')}" style="width:min(420px,100%)">${escHtml((s.models || []).join('\n'))}</textarea></div>
    ${advancedFold(`<div class="form-row"><span class="tool-label">Port</span><input class="input" id="mr-port" type="number" min="1024" max="65535" data-default="4243" value="${escHtml(String(s.port || ''))}" placeholder="4243" style="width:110px"></div>
      <div class="form-row"><span class="tool-label">Address${infoBtn('Empty: the Docker bridge on Linux, loopback elsewhere. Never the tailnet or the local network.')}</span><input class="input" id="mr-address" data-default="" value="${escHtml(s.address || '')}" placeholder="the Docker bridge" style="width:200px"></div>`,
    { id: 'model-relay-where', label: 'Advanced — where it listens' })}
    <div class="desc" id="mr-state" style="margin:8px 0;font-size:11px">${where}</div>
    <button class="btn btn-xs btn-primary" onclick="modelRelaySave()">Save</button>`;
}

async function modelRelaySave() {
  const v = id => document.getElementById(id);
  const body = { enabled: v('mr-enabled').checked, computers: v('mr-computers').checked, models: v('mr-models').value };
  if (v('mr-port').value) body.port = Number(v('mr-port').value);
  body.address = v('mr-address').value.trim();
  try { await apiFetch('/api/computers/relay', { method: 'POST', body }); } catch (e) { return appAlert(e.message); }
  modelRelayRender();
}
