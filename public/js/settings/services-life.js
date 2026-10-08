/* Settings → System → Services (modules/service-life): the one switch that stops the services DOCA started when
   nothing has used them, and whether they stop when DOCA itself stops. Each row's own choices are on its row
   (Field → Models → Inference Services, and the llama.cpp servers), under Advanced. */
async function servicesLifeCard() {
  const panel = document.getElementById('sp-system');
  if (!panel) return;
  let d;
  try { d = await apiFetch('/api/services/life'); } catch { document.getElementById('services-life-card')?.remove(); return; }   // not an admin
  let card = document.getElementById('services-life-card');
  if (!card) {
    card = Object.assign(document.createElement('div'), { className: 'card', id: 'services-life-card' });
    const after = document.getElementById('network-card') || document.getElementById('host-caps-card');
    if (after) after.after(card); else panel.prepend(card);
  }
  const s = d.settings || {}, on = s.idleStopMinutes > 0;
  card.innerHTML = `<div class="card-title">Services — stopping what nothing uses</div>
    <p style="font-size:11px;color:var(--muted);margin:0 0 6px">The inference services and llama.cpp servers DOCA started hold memory, often a GPU's, while they run.
      A service started outside DOCA is left alone unless its row says "Let DOCA manage it".</p>
    <label style="display:flex;gap:8px;align-items:center;font-size:12px;margin:6px 0;flex-wrap:wrap">
      <input type="checkbox" id="slife-on" data-default="false" data-label="Stop services nothing has used" ${on ? 'checked' : ''}>
      Stop services nothing has used for
      <input class="input" type="number" min="1" max="10080" id="slife-min" data-label="Minutes" style="width:70px" value="${on ? s.idleStopMinutes : 30}"> minutes
      <span style="color:var(--muted);font-size:11px;flex-basis:100%">Counted only while no page of the panel is open and no call is on — while the panel is open they stay on, so answers come quickly.
        One that a request then needs starts again by itself (each row's "Start when needed") and the person is told.</span></label>
    <label style="display:flex;gap:8px;align-items:center;font-size:12px;margin:6px 0;flex-wrap:wrap">
      <input type="checkbox" id="slife-exit" data-default="false" data-label="Stop them when DOCA stops" ${s.stopWithDoca ? 'checked' : ''}>
      Stop them when DOCA stops
      <span style="color:var(--muted);font-size:11px;flex-basis:100%">When DOCA itself is shut down (by its launcher, the system, or Ctrl+C) — not when a browser tab closes, and not on a restart or a version switch. Each row can be unticked.</span></label>
    <div class="toolbar"><button class="btn btn-sm btn-blue" onclick="servicesLifeSave()">Save</button><span class="status-line" id="slife-status"></span></div>`;
}

async function servicesLifeSave() {
  const on = document.getElementById('slife-on').checked;
  const minutes = Number(document.getElementById('slife-min').value) || 30;
  try {
    await apiFetch('/api/services/life', { method: 'POST', body: { idleStopMinutes: on ? minutes : 0, stopWithDoca: document.getElementById('slife-exit').checked } });
    setStatus(document.getElementById('slife-status'), '✓ Saved', 'ok');
  } catch (e) { setStatus(document.getElementById('slife-status'), e.message, 'err'); }
}
