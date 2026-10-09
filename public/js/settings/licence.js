/* ═══════════════════════════════════════════════════════
   Settings → System → Licence (modules/license): what this hive may run and until when, its fingerprint, adding a
   licence file (offline) or a key and the licence server to check in with, and Check now. A change takes effect at
   the next start; the card says so.
   ═══════════════════════════════════════════════════════ */

async function licenceCard() {
  const host = document.getElementById('sp-system');
  if (!host) return;
  let card = document.getElementById('licence-card');
  if (!card) { card = Object.assign(document.createElement('div'), { id: 'licence-card', className: 'card' }); host.prepend(card); }
  const L = await licenceLoad();
  if (!L.catalogue) { card.remove(); return; }   // not a host: nothing to manage here
  const day = s => (s ? String(s).slice(0, 10) : '—');
  const codes = L.all ? ['all — every feature, and what later releases add'] : (L.codes || []).map(c => `${c} — ${L.catalogue.codes[c]?.label || c}`);
  const state = L.readOnly ? `<span style="color:var(--red)">read-only</span>`
    : L.source === 'grace' ? `<span style="color:var(--amber)">no licence yet — every feature until ${day(L.grace?.until)}</span>`
    : L.valid ? `<span style="color:var(--green)">licensed</span>` : 'core only (no licence)';
  const row = (k, v) => `<div class="settings-tab-row"><span class="settings-tab-label" style="min-width:140px">${k}</span><span>${v}</span></div>`;
  card.innerHTML = `<div class="card-title">Licence</div>
    <p class="desc">Which features this hive runs. Without a licence it runs the core; a licence adds the rest. A change takes effect when the hub next starts.</p>
    ${row('State', state)}
    ${row('Mode', `${L.mode === 'production' ? 'production — every safety applies to everyone; DOCA itself is not changed from inside' : 'development — DOCA may be debugged and changed from within'} <span style="opacity:.6">(${escHtml(L.modeWhy || '')})</span>`)}
    ${L.problem ? row('Problem', escHtml(L.problem.why)) : ''}
    ${L.customer ? row('For', escHtml(L.customer)) : ''}
    ${L.edition ? row('Edition', escHtml(L.edition)) : ''}
    ${row('Enables', codes.length ? escHtml(codes.join(' · ')) : 'core only')}
    ${row('Expires', L.expiry ? day(L.expiry) : L.valid ? 'does not expire' : '—')}
    ${L.checkInDays ? row('Checks in', `every ${L.checkInDays} days · last ${day(L.lastCheckIn)}${L.lastError ? ` · <span style="color:var(--amber)">${escHtml(L.lastError)}</span>` : ''}`) : ''}
    ${L.seats ? row('Seats', licenceLimit(L.limits?.seats, L.seats, L.limits?.enforced)) : ''}${L.maxDevices ? row('Devices', licenceLimit(L.limits?.devices, L.maxDevices, L.limits?.enforced)) : ''}
    ${row('This hive', `<code style="font-size:11px;word-break:break-all">${escHtml(L.fingerprint)}</code> <button class="btn btn-sm" onclick="navigator.clipboard?.writeText('${L.fingerprint}')">Copy</button>`)}
    ${L.restartNeeded ? `<p class="desc" style="color:var(--amber)">${escHtml(L.nextStart)}</p>` : ''}
    ${L.trustsKeys ? '' : '<p class="desc">This build trusts no licence server yet: no licence can be checked until a release names one.</p>'}
    <div class="form-row" style="margin-top:10px"><label>Licence key</label>
      <input id="licence-key" class="input flex1" type="password" autocomplete="off" placeholder="${L.hasKey ? 'kept — type to replace' : 'from your licence e-mail'}"></div>
    ${advancedFold(`<div class="form-row"><label>Licence server</label><input id="licence-server" class="input flex1" data-default="" value="${escHtml(L.server || '')}" placeholder="https://… (empty: offline)"></div>
      <div class="form-row"><label>Account</label><input id="licence-account" class="input flex1" data-default="" value="${escHtml(L.account || '')}" placeholder="the server's account id"></div>`, { id: 'licence-server', count: 2 })}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-primary btn-sm" onclick="licenceSaveKey()">Save</button>
      <button class="btn btn-sm" onclick="licenceCheck()" ${L.server ? '' : 'disabled title="Set the licence server first"'}>Check now</button>
      <label class="btn btn-sm">Upload a licence file<input type="file" accept=".lic,.txt,text/plain" style="display:none" onchange="licenceUpload(this.files[0])"></label>
      ${L.source === 'file' ? '<button class="btn btn-sm btn-red" onclick="licenceRemove()">Remove</button>' : ''}
    </div>
    <div id="licence-said" class="desc" style="margin-top:8px"></div>`;
}

/** "3 of 5 used", and whether it is held (production only: license/limits.js). */
function licenceLimit(l, max, enforced) { return `${l?.used ?? '—'} of ${max} used${enforced ? '' : ' (not held in a development hive)'}`; }

function licenceSaid(text, bad) { const el = document.getElementById('licence-said'); if (el) { el.textContent = text; el.style.color = bad ? 'var(--red)' : ''; } }

async function licenceSaveKey() {
  const key = document.getElementById('licence-key')?.value || '';
  const body = { server: document.getElementById('licence-server')?.value || '', account: document.getElementById('licence-account')?.value || '' };
  if (key) body.key = key;
  try { await apiFetch('/api/licence/key', { method: 'POST', body }); await licenceCard(); licenceSaid('Saved.'); }
  catch (e) { licenceSaid(e.message, true); }
}

async function licenceCheck() {
  licenceSaid('Checking in…');
  try { const r = await apiFetch('/api/licence/check', { method: 'POST' }); await licenceCard(); licenceSaid(r.said); }
  catch (e) { licenceSaid(e.message, true); }
}

async function licenceUpload(file) {
  if (!file) return;
  const certificate = await file.text();
  const key = document.getElementById('licence-key')?.value || undefined;
  try { const r = await apiFetch('/api/licence/file', { method: 'POST', body: { certificate, key } }); await licenceCard(); licenceSaid(r.said); }
  catch (e) { licenceSaid(e.message, true); }
}

function licenceRemove() {
  appConfirm('Remove the licence file? Licensed features stay until the hub next starts, then only the core runs.', () => licenceRemoveNow());
}
async function licenceRemoveNow() {
  try { const r = await apiFetch('/api/licence', { method: 'DELETE' }); await licenceCard(); licenceSaid(r.said); }
  catch (e) { licenceSaid(e.message, true); }
}
