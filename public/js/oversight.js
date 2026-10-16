/* ═══════════════════════════════════════════════════════
   Other people's work, in the header (modules/oversight; the owner's decision of 2026-10-16). Apart from the person's
   own notices and questions (agent-ui/notices.js, the questions dock): an icon with an unread count that opens a list of
   the work of the people a host may see — missions and work chats started, finished, failed, waiting, stopped — newest
   first, each opening its conversation. Fed by GET /api/oversight, read again when the live feed says a mission or a
   conversation moved; nothing here is written by a model. Drawn only for someone holding host (a 403 draws nothing).
   Opt-in per person: the switch is in the list itself and in Settings → General.
   ═══════════════════════════════════════════════════════ */

const OVS = { view: null, open: false };
const _OVS_EVENT = { started: 'Started', finished: 'Finished', failed: 'Failed', waiting: 'Waiting', stopped: 'Stopped', paused: 'Paused' };

async function oversightLoad() {
  try { OVS.view = await apiFetch('/api/oversight'); } catch { OVS.view = null; }
  _ovsButton();
  if (OVS.open) _ovsPanel();
  if (typeof oversightCard === 'function' && document.getElementById('oversight-card')) oversightCard();
}

function _ovsButton() {
  let b = document.getElementById('oversight-btn');
  if (!OVS.view) { b?.remove(); return; }
  if (!b) {
    b = Object.assign(document.createElement('button'), { id: 'oversight-btn', type: 'button', className: 'oversight-btn' });
    b.setAttribute('aria-haspopup', 'dialog');
    b.onclick = e => { e.stopPropagation(); OVS.open ? oversightClose() : oversightOpen(); };
    const right = document.querySelector('header .header-right');
    if (!right) return;
    right.insertBefore(b, document.getElementById('clock'));
  }
  const n = OVS.view.on ? OVS.view.unread : 0;
  b.innerHTML = `${uiIcon('agents', 16)}${n ? `<span class="oversight-count">${n > 99 ? '99+' : n}</span>` : ''}`;
  b.title = OVS.view.on ? `Other people's work${n ? ` — ${n} new` : ''}` : 'Other people\'s work (off)';
  b.setAttribute('aria-label', b.title);
  b.classList.toggle('off', !OVS.view.on);
}

function oversightOpen() { OVS.open = true; _ovsPanel(); }

function oversightClose() {
  OVS.open = false;
  document.getElementById('oversight-panel')?.remove();
  const v = OVS.view;
  if (v?.on && v.unread) apiFetch('/api/oversight/seen', { method: 'POST', body: { at: v.items[0]?.at } }).then(r => { OVS.view = r; _ovsButton(); }).catch(() => {});
}

function _ovsWhen(at) {
  const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(at).toLocaleDateString();
}

function _ovsPanel() {
  const v = OVS.view;
  if (!v) return;
  let p = document.getElementById('oversight-panel');
  if (!p) {
    p = Object.assign(document.createElement('div'), { id: 'oversight-panel', className: 'oversight-panel' });
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Other people\'s work');
    p.onclick = e => e.stopPropagation();
    document.body.append(p);
  }
  const h = document.querySelector('header')?.getBoundingClientRect().bottom || 52;
  p.style.top = `${Math.round(h) + 4}px`;
  const rows = (v.items || []).map(i => `<button type="button" class="oversight-item${i.unread ? ' unread' : ''}" data-ovs-open="${escHtml(i.sessionId)}">
      <span class="pt ${i.event === 'failed' ? 'pt-err' : i.event === 'started' ? 'pt-run' : ''}" aria-hidden="true"></span>
      <span class="oversight-item-body"><span class="oversight-item-head"><b>${escHtml(_OVS_EVENT[i.event] || i.event)}</b> · ${escHtml(i.who)} · <span class="desc">${escHtml(_ovsWhen(i.at))}</span></span>
        <span class="oversight-item-title">${escHtml(i.title)}</span>${i.detail ? `<span class="desc oversight-item-detail">${escHtml(i.detail)}</span>` : ''}</span></button>`).join('');
  p.innerHTML = `<div class="oversight-head"><b>Other people's work</b>
      <label class="oversight-switch"><input type="checkbox" ${v.on ? 'checked' : ''} data-ovs-switch> Follow</label>
      <button type="button" class="btn btn-sm" data-ovs-close aria-label="Close">${uiIcon('close', 14)}</button></div>
    <p class="desc oversight-note">Missions and work chats of the people you may see. Your own work and questions are in your own notices; nothing here reaches your devices.</p>
    <div class="oversight-list">${!v.on ? '<p class="desc">Off. Switch on "Follow" to see their work here.</p>' : rows || '<p class="desc">Nothing from anyone else yet.</p>'}</div>`;
  p.querySelector('[data-ovs-close]').onclick = oversightClose;
  p.querySelector('[data-ovs-switch]').onchange = e => oversightSwitch(e.target.checked);
  p.querySelectorAll('[data-ovs-open]').forEach(el => { el.onclick = () => { oversightClose(); oversightGo(el.dataset.ovsOpen); }; });
}

function oversightGo(sessionId) {
  if (typeof nav === 'function') nav('harness');
  if (typeof hcOpenSession === 'function') hcOpenSession(sessionId);
}

async function oversightSwitch(on) {
  try { OVS.view = await apiFetch('/api/oversight/switch', { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  _ovsButton();
  if (OVS.open) _ovsPanel();
  if (typeof oversightCard === 'function' && document.getElementById('oversight-card')) oversightCard();
}

/** Settings → General: the same switch, for someone holding host. */
async function oversightCard() {
  const anchor = document.getElementById('chat-notify-card') || document.getElementById('your-panel-card') || document.getElementById('settings-tabs-list')?.closest('.card');
  if (!anchor) return;
  if (!OVS.view) { try { OVS.view = await apiFetch('/api/oversight'); } catch { return; } }
  let card = document.getElementById('oversight-card');
  if (!card) { card = Object.assign(document.createElement('div'), { id: 'oversight-card', className: 'card' }); anchor.after(card); }
  card.innerHTML = `<div class="card-title">Other people's work</div>
    <p class="desc">An icon in the header lists the missions and work chats of the people you may see — started, finished, failed, waiting, stopped — apart from your own notices. Yours alone; nothing of it reaches your devices.</p>
    <label class="form-row" style="align-items:center;gap:8px"><input type="checkbox" ${OVS.view.on ? 'checked' : ''} onchange="oversightSwitch(this.checked)"> Follow other people's work</label>`;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('chat-fab')) return;   // the panel only, not a page served alone
  document.addEventListener('click', () => { if (OVS.open) oversightClose(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && OVS.open) oversightClose(); });
  oversightLoad();
  if (typeof liveOn === 'function' && typeof liveDebounce === 'function') {
    const again = liveDebounce(() => { if (OVS.view) oversightLoad(); }, 800);
    liveOn('missions', again);
    liveOn('conversation', c => { if (c.what === 'started' || c.what === 'ended' || c.what === 'resync') again(); });
  }
});
