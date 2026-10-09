/* A new device waits until someone who may approve it says yes (modules/devices-approval; the owner's decision of
   2026-10-09). Here, for whoever may decide it: a card in the questions dock — "A new device: <name> for <person> —
   Allow / Refuse" with where it paired from and what it would hold — that comes on the live feed's `device` topic and
   goes when it is decided anywhere (on a phone, a watch, another page); a page opened later finds the ones still
   waiting in GET /api/devices/pending. The device list (Field → API keys) draws the same two buttons on its row. */

const _devApproveCards = new Map();   // device id -> card element

/** "phone · Google Pixel 8 · paired from the local network (192.168.1.40)" */
function _devApproveFacts(d) {
  const where = d.from ? `paired from ${d.from.network}${d.from.address ? ` (${d.from.address})` : ''}` : '';
  return [d.formFactor, d.model, where].filter(Boolean).join(' · ');
}

function _devApproveCardShow(d) {
  if (!d?.id || _devApproveCards.has(d.id) || typeof _questionsDock !== 'function') return;
  const card = document.createElement('div');
  card.className = 'question-card notice-card';
  card.innerHTML = `<div class="notice-card-head"><span class="notice-card-title"></span></div>
    <div class="notice-card-text dev-approve-facts"></div><div class="notice-card-text dev-approve-scopes"></div>
    <div class="toolbar-right mt8"><button class="btn btn-xs" data-v="refuse">Refuse</button><button class="btn btn-xs btn-blue" data-v="approve">Allow</button></div>
    <div class="status-line"></div>`;
  card.querySelector('.notice-card-title').textContent = `A new device: ${d.name}${d.person ? ` for ${d.person.name}` : ''}`;
  card.querySelector('.dev-approve-facts').textContent = _devApproveFacts(d);
  card.querySelector('.dev-approve-scopes').textContent = `It would hold: ${(d.scopes || []).join(' ') || 'nothing'}`;
  for (const b of card.querySelectorAll('button[data-v]')) b.onclick = () => devDecide(d.id, b.dataset.v, card.querySelector('.status-line'));
  _devApproveCards.set(d.id, card);
  _questionsDock().prepend(card);
  try {
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`A new device: ${d.name}`, { body: _devApproveFacts(d) });
  } catch { /* not offered here */ }
}

function _devApproveCardDrop(id) { _devApproveCards.get(id)?.remove(); _devApproveCards.delete(id); }

/** Allow or refuse a waiting device; `status` is where a refusal of the request is said. */
async function devDecide(id, verb, status) {
  try {
    await apiFetch(`/api/devices/${encodeURIComponent(id)}/${verb}`, { method: 'POST', body: {} });
    _devApproveCardDrop(id);
    if (typeof devicesLoad === 'function') devicesLoad();
  } catch (e) {
    if (status) { status.textContent = e.message; status.className = 'status-line err'; }
    else if (typeof appAlert === 'function') appAlert(e.message);
  }
}

async function _devApproveWaiting() {
  try { for (const d of (await apiFetch('/api/devices/pending')).devices || []) _devApproveCardShow(d); }
  catch { /* signed out, or a level that approves none */ }
}

/** The device list's line for a waiting device: who was asked, and Allow / Refuse when this person may decide. */
function devApprovalHtml(d) {
  if (d.approval?.state !== 'pending' || d.revokedAt) return '';
  const asked = (d.approval.askedOf || []).map(a => a.name).join(', ');
  return `<div class="input-label mt8" style="text-transform:none;letter-spacing:0;color:var(--amber)">
      Waiting for approval${asked ? ` — asked of ${escHtml(asked)}` : ''}. Until then it can only read its own record and wait.
      ${d.canDecide ? `<button class="btn btn-xs btn-blue" onclick="devDecide(${jsArg(d.id)}, 'approve')">Allow</button>
        <button class="btn btn-xs" onclick="devDecide(${jsArg(d.id)}, 'refuse')">Refuse</button>` : ''}</div>`;
}

/** The pairing card's line: allowed as it pairs, or a tap once it shows up (and who would be asked). */
function devPairApprovalHtml(p) {
  const a = p?.approval;
  if (!a) return '';
  const text = a.state === 'approved' ? 'It is allowed as it pairs.'
    : `Once it pairs it waits for approval: ${a.askedOf?.length ? `asked of ${a.askedOf.join(', ')}` : 'nobody here may approve it yet'} — Allow appears here.`;
  return `<div class="input-label mt8" style="text-transform:none;letter-spacing:0">${escHtml(text)}</div>`;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  if (typeof liveOn !== 'function' || !document.getElementById('chat-fab')) return;
  liveOn('device', c => {
    if (c.what === 'pending') { _devApproveCardShow(c.device); if (typeof devicesLoad === 'function') devicesLoad(); return; }
    if (c.what === 'decided') { _devApproveCardDrop(c.id); if (typeof devicesLoad === 'function') devicesLoad(); return; }
    if (c.what === 'resync') _devApproveWaiting();
  });
  _devApproveWaiting();
});
