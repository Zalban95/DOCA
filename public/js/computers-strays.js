/* ═══════════════════════════════════════════════════════
   COMPUTERS → NOT DOCA'S RECORDS (modules/computers/strays.js; the owner's
   answer of 2026-10-08): computer containers on this machine that no record
   names — left alone by default, listed here for a person to archive (adopted
   as a computer in the Archive, stopped, its files kept) or delete. The select
   is what the tidy-up does with stopped ones no install labels.
   ═══════════════════════════════════════════════════════ */

const COMPUTERS_STRAY_POLICY = { leave: 'Leave them', archive: 'Archive them', delete: 'Delete them (files kept)' };
const COMPUTERS_STRAY_INSTALL = { this: 'made by this DOCA', another: 'another DOCA\'s', none: 'no install label' };

/** Fill #computers-strays under the grid; nothing is drawn when there are none and the tidy-up leaves them. */
async function computersStraysLoad() {
  const box = document.getElementById('computers-strays');
  if (!box) return;
  let d;
  try { d = await apiFetch('/api/computers/strays'); } catch { box.innerHTML = ''; return; }
  const rows = d.strays.map(s => `<div class="pc-stray">
      <span class="pc-dot ${s.state === 'running' ? 'on' : ''}"></span><b>${escHtml(s.name)}</b>
      <span class="pc-dim">${escHtml(s.status)}${s.createdAt ? ` · made ${escHtml(new Date(s.createdAt).toLocaleString())}` : ''} · ${escHtml(COMPUTERS_STRAY_INSTALL[s.install] || s.install)}</span>
      <span style="flex:1"></span>
      <button class="btn btn-xs" onclick="computersStrayArchive(${jsArg(s.name)})" title="Keep it as a computer in Agents → Archive: stopped, its files kept, lent again like any computer">Archive</button>
      <button class="btn btn-xs btn-red" onclick="computersStrayDelete(${jsArg(s.name)})" title="Remove the container; you choose whether its files go too">Delete</button></div>`).join('');
  box.innerHTML = `<div class="card pc-strays"><div class="card-title">Not DOCA's records</div>
    <div class="desc">Computer containers on this machine that no computer here names — from a computer that failed to start, a record
      that was lost, or another DOCA sharing this Docker. Nothing is done to them unless you choose.</div>
    ${rows || '<div class="pc-dim" style="padding:4px 0">None now.</div>'}
    <label class="pc-dim pc-stray-policy">When the tidy-up finds a stopped one no install labels:
      <select class="input" style="width:auto" onchange="computersStrayPolicy(this.value)">${d.choices.map(c => `<option value="${c}" ${c === d.policy ? 'selected' : ''}>${escHtml(COMPUTERS_STRAY_POLICY[c] || c)}</option>`).join('')}</select></label></div>`;
}

async function computersStrayArchive(name) {
  try { await apiFetch(`/api/computers/strays/${encodeURIComponent(name)}/archive`, { method: 'POST' }); appAlert(`${name} is in Agents → Archive now, stopped, with its files.`); }
  catch (e) { appAlert(e.message); }
  computersStraysLoad();
}

function computersStrayDelete(name) {
  appConfirm(`Delete the container ${name}? Whatever runs in it is lost.`, () => appChoose(`And its files (the volume ${name})?`, [
    { label: 'Remove its files too', value: true, cls: 'btn-red' }, { label: 'Keep its files', value: false }], async volume => {
    try { await apiFetch(`/api/computers/strays/${encodeURIComponent(name)}${volume ? '?volume=1' : ''}`, { method: 'DELETE' }); }
    catch (e) { appAlert(e.message); }
    computersStraysLoad();
  }));
}

async function computersStrayPolicy(strays) {
  try { await apiFetch('/api/computers/strays/policy', { method: 'POST', body: { strays } }); } catch (e) { appAlert(e.message); }
  computersStraysLoad();
}
