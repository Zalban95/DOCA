/* ═══════════════════════════════════════════════════════
   Settings → System → Licence for test computers (modules/license/pool.js): the licence whose seats the hub hands to
   DOCA installs inside agents' computers — its key (kept on the hub, never shown again), its server, how many seats,
   and which computers hold them, each freed with one click. A host's; drawn after the licence card.
   ═══════════════════════════════════════════════════════ */

async function licencePoolCard() {
  const sys = document.getElementById('sp-system');
  if (!sys) return;
  let P;
  try { P = await apiFetch('/api/licence/computers'); } catch { document.getElementById('licence-pool-card')?.remove(); return; }   // not a host
  let card = document.getElementById('licence-pool-card');
  if (!card) {
    card = Object.assign(document.createElement('div'), { id: 'licence-pool-card', className: 'card' });
    const after = document.getElementById('licence-card');
    if (after) after.after(card); else sys.prepend(card);
  }
  const day = s => (s ? String(s).slice(0, 10) : '—');
  const held = (P.inUse || []).map(h => `<div class="settings-tab-row"><span class="settings-tab-label" style="min-width:140px">${escHtml(h.name)} <span style="opacity:.6">${escHtml(h.computer)}</span></span>
      <span>${h.releasing ? `<span style="color:var(--amber)">removed — not freed yet: ${escHtml(h.releasing.why)}</span>` : `since ${day(h.at)}${h.fileExpiry ? ` · file good until ${day(h.fileExpiry)}` : ''}`}
      <button class="btn btn-sm" onclick="licencePoolFree('${escHtml(h.computer)}')">Free</button></span></div>`).join('');
  card.innerHTML = `<div class="card-title">Licence for test computers</div>
    <p class="desc">When an agent installs ${escHtml((typeof BRAND !== 'undefined' && BRAND?.product) || 'a hive')} inside one of its computers to try something, the hub gives that install a seat of this licence. Removing or archiving the computer frees its seat. Use a licence made for this alone, not this hive's own: the licence file a computer receives carries its key.</p>
    ${P.set ? `<div class="settings-tab-row"><span class="settings-tab-label" style="min-width:140px">Seats</span><span>${(P.inUse || []).length} of ${P.seats} in use</span></div>${held}` : ''}
    <div class="form-row" style="margin-top:10px"><label>Licence key${infoBtn('The key of the licence for test computers. Kept on the hub and never shown again; type a new one to replace it.')}</label>
      <input id="licence-pool-key" class="input flex1" type="password" autocomplete="off" placeholder="${P.set ? 'kept — type to replace' : 'the key of the licence for test computers'}"></div>
    <div class="form-row"><label>Licence server${infoBtn('Where the hub activates the seat of each test computer. The computer never calls it.')}</label><input id="licence-pool-server" class="input flex1" value="${escHtml(P.server || '')}" placeholder="https://…"></div>
    <div class="form-row"><label>Seats${infoBtn('How many test computers may hold a licence at once.')}</label><input id="licence-pool-seats" class="input" type="number" min="1" max="100" style="width:90px" value="${P.seats || 6}"></div>
    ${advancedFold(`<div class="form-row"><label>Account${infoBtn('Your account id on the licence server, when it asks for one.')}</label><input id="licence-pool-account" class="input flex1" data-default="" value="${escHtml(P.account || '')}"></div>`, { id: 'licence-pool-server', count: 1 })}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-primary btn-sm" onclick="licencePoolSave()">Save</button>
      ${P.set ? '<button class="btn btn-sm btn-red" onclick="licencePoolForget()">Remove</button>' : ''}
    </div>
    <div id="licence-pool-said" class="desc" style="margin-top:8px"></div>`;
}

function licencePoolSaid(text, bad) { const el = document.getElementById('licence-pool-said'); if (el) { el.textContent = text; el.style.color = bad ? 'var(--red)' : ''; } }

async function licencePoolSave() {
  const v = id => document.getElementById(id)?.value || '';
  const body = { server: v('licence-pool-server'), account: v('licence-pool-account'), seats: Number(v('licence-pool-seats')) || 1 };
  if (v('licence-pool-key')) body.key = v('licence-pool-key');
  try { const r = await apiFetch('/api/licence/computers', { method: 'POST', body }); await licencePoolCard(); licencePoolSaid(r.said); }
  catch (e) { licencePoolSaid(e.message, true); }
}

async function licencePoolFree(computer) {
  try { const r = await apiFetch(`/api/licence/computers/seats/${encodeURIComponent(computer)}`, { method: 'DELETE' }); await licencePoolCard(); licencePoolSaid(r.said); }
  catch (e) { licencePoolSaid(e.message, true); }
}

function licencePoolForget() {
  appConfirm('Remove the licence for test computers? Every seat it holds is freed first; the test installs keep their files until they expire.', async () => {
    try { const r = await apiFetch('/api/licence/computers', { method: 'DELETE' }); await licencePoolCard(); licencePoolSaid(r.said); }
    catch (e) { licencePoolSaid(e.message, true); }
  });
}
