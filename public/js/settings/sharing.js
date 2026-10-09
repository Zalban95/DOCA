/* Settings → Packs → Share with the project (modules/sharing.js; CONSTITUTION §0, step 4): the owner's answer — asked
   at installation, changed here — the project's hub, and the packs the agents kept, each sent only by the owner's click. */
async function sharingRender() {
  const lib = document.getElementById('pack-library');
  if (!lib || !(typeof licenceFeatureOn !== 'function' || licenceFeatureOn('sharing'))) return;   // not licensed here (lib/licence.js)
  let card = document.getElementById('pack-sharing');
  if (!card) { card = Object.assign(document.createElement('div'), { className: 'card', id: 'pack-sharing' }); lib.before(card); }
  let s;
  try { s = await apiFetch('/api/sharing'); } catch (e) { card.innerHTML = `<div class="card-title">Share with the project</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const hubOpts = s.hubs.map(h => `<option value="${escHtml(h.id)}" ${h.id === s.upstream ? 'selected' : ''}>${escHtml(h.label)}</option>`).join('');
  card.innerHTML = `<div class="card-title">Share with the project</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">When your agents find a way to do something new, they keep it as a skill, a recipe or a
      specialist. With this on, those can be offered to the project, so other installs get them too. Nothing is sent without your click, and packs never carry secrets.</p>
    ${s.decided ? '' : '<p style="font-size:12px;color:var(--amber);margin-bottom:8px">Not decided yet — choose below.</p>'}
    <div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="share-on" ${s.contribute ? 'checked' : ''} onchange="sharingSave()"> Offer what my agents learn to the project</label>
      <select class="input" id="share-hub" style="width:auto" onchange="sharingSave()" ${s.hubs.length ? '' : 'disabled'}>
        <option value="">${s.hubs.length ? 'The project\'s hub…' : 'Add the project\'s hub below first'}</option>${hubOpts}</select></div>
    ${s.contribute ? (s.candidates.map(p => `<div class="disk-row"><span class="disk-label">${escHtml(p.name)} <span style="color:var(--muted)">${escHtml(p.savedAt.slice(0, 10))}</span></span>
      <span class="disk-path">${escHtml(p.contents.map(c => `${c.kind}${c.id ? ` ${c.id}` : ''}`).join(', '))}</span>
      <span class="disk-free">${p.sentAt ? `<span style="font-size:11px;color:var(--muted)">sent ${escHtml(p.sentAt.slice(0, 10))}</span>`
        : `<button class="btn btn-xs btn-blue" ${s.upstream ? '' : 'disabled title="Choose the project\'s hub first"'} onclick="sharingSend(${jsArg(p.id)})">Share</button>`}</span></div>`).join('')
      || '<div class="placeholder">Nothing kept by the agents yet.</div>') : ''}`;
}

async function sharingSave() {
  try { await apiFetch('/api/sharing', { method: 'POST', body: { contribute: document.getElementById('share-on').checked, upstream: document.getElementById('share-hub').value } }); }
  catch (e) { appAlert(e.message); }
  sharingRender();
}

async function sharingSend(id) {
  try { await apiFetch(`/api/sharing/${encodeURIComponent(id)}/share`, { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
  sharingRender();
}
