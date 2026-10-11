/* Machines → Nearby: saving a thing with a name, a place and a room, and the rest of what changes one (nearby.js draws
   the page). Places and rooms are the person's own words, offered back as chips once used — "＋ New place" and
   "＋ New room" add one — so the same room is never typed two ways. Removing a saved thing offers Undo; forgetting a
   seen one asks first; pairing a Bluetooth device asks, then relays what pairing asks back (a passkey to compare, a
   PIN to type) and says plainly when it has to be started on the device. */
const NBS = { ov: null, release: null, seenId: null, id: null, place: '', room: '' };

/** Open the dialog: for a seen thing (`seenId`) to save, or a saved one (`id`) to rename or move. */
function nearbySaveOpen(seenId, id) {
  const d = NB.data;
  const t = id ? d.saved.find(x => x.id === id) : d.seen.find(x => x.id === seenId);
  if (!t) return appAlert('It is not in the list any more: scan again.');
  Object.assign(NBS, { seenId: id ? null : seenId, id: id || null, place: t.place || d.places[0]?.name || 'Home', room: t.room || t.area || '' });
  nearbySaveClose();
  const ov = Object.assign(document.createElement('div'), { className: 'modal-overlay nb-modal' });
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Save">
      <div class="modal-title">${id ? 'Rename or move' : 'Save'} ${escHtml(t.name)}</div>
      <label class="nb-field"><span class="input-label">Name${infoBtn('What you call it — what the agent hears when you say "play this on …". Any name you like.')}</span><input class="input" id="nbs-name" maxlength="60" value="${escHtml(t.name)}"></label>
      <div class="nb-field"><span class="input-label">Place${infoBtn('Where it is: a home, the lab, the office, a holiday house — any place you make. Places you used before are offered here.')}</span><div class="nb-chips" id="nbs-places"></div></div>
      <div class="nb-field"><span class="input-label">Room${infoBtn('The room in that place, if you like: Living room, Kitchen, Desk. Empty is fine.')}</span><div class="nb-chips" id="nbs-rooms"></div></div>
      <label class="nb-field"><span class="input-label">Kind${infoBtn('What it is. Guessed from what it announced; change it when the guess is wrong.')}</span><select class="input" id="nbs-kind">${Object.entries(NB_KIND).map(([k, l]) => `<option value="${k}"${k === t.kind ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select></label>
      <div class="modal-actions"><button class="btn btn-sm" onclick="nearbySaveClose()">Cancel</button><button class="btn btn-sm btn-primary" onclick="nearbySaveSubmit()">Save</button></div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) nearbySaveClose(); });
  document.body.appendChild(ov);
  NBS.ov = ov;
  NBS.release = typeof overlayBack === 'function' ? overlayBack(() => nearbySaveClose(true)) : () => {};
  _nbsChips();
  ov.querySelector('#nbs-name').focus();
}

function nearbySaveClose(fromBack) {
  if (!NBS.ov) return;
  NBS.ov.remove();
  NBS.ov = null;
  if (!fromBack) NBS.release?.();
  NBS.release = null;
}

/** The place and room chips: the ones made before, the chosen one marked, and a way to add one. */
function _nbsChips() {
  const places = NB.data.places.map(p => p.name);
  if (NBS.place && !places.includes(NBS.place)) places.push(NBS.place);
  const rooms = (NB.data.places.find(p => p.name === NBS.place)?.rooms || []).slice();
  if (NBS.room && !rooms.includes(NBS.room)) rooms.push(NBS.room);
  const chip = (v, on, fn) => `<button type="button" class="nb-pick${on ? ' on' : ''}" aria-pressed="${on}" onclick="${fn}(${jsArg(v)})">${escHtml(v)}</button>`;
  NBS.ov.querySelector('#nbs-places').innerHTML = places.map(p => chip(p, p === NBS.place, '_nbsPlace')).join('')
    + '<button type="button" class="nb-pick nb-new" onclick="_nbsNew(\'place\')">＋ New place</button>';
  NBS.ov.querySelector('#nbs-rooms').innerHTML = chip('No room', !NBS.room, '_nbsNoRoom') + rooms.map(r => chip(r, r === NBS.room, '_nbsRoom')).join('')
    + '<button type="button" class="nb-pick nb-new" onclick="_nbsNew(\'room\')">＋ New room</button>';
}
function _nbsPlace(v) { if (NBS.place !== v) NBS.room = ''; NBS.place = v; _nbsChips(); }
function _nbsRoom(v) { NBS.room = v; _nbsChips(); }
function _nbsNoRoom() { NBS.room = ''; _nbsChips(); }

/** "＋ New place" / "＋ New room": an inline field in place of the button; Enter keeps it. */
function _nbsNew(what) {
  const box = NBS.ov.querySelector(what === 'place' ? '#nbs-places' : '#nbs-rooms');
  box.querySelector('.nb-new')?.remove();
  const input = Object.assign(document.createElement('input'), { className: 'input nb-new-input', maxLength: what === 'place' ? 60 : 40, placeholder: what === 'place' ? 'Home, Lab, Office…' : 'Living room, Kitchen…' });
  input.setAttribute('aria-label', what === 'place' ? 'New place' : 'New room');
  const keep = () => { const v = input.value.trim(); if (v) { if (what === 'place') { NBS.place = v; NBS.room = ''; } else NBS.room = v; } _nbsChips(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); keep(); } if (e.key === 'Escape') { e.stopPropagation(); _nbsChips(); } });
  input.addEventListener('blur', () => { if (input.isConnected && input.value.trim()) keep(); });
  box.appendChild(input);
  input.focus();
}

async function nearbySaveSubmit() {
  const pending = NBS.ov?.querySelector('.nb-new-input');
  if (pending?.value.trim()) { if (pending.closest('#nbs-places')) { NBS.place = pending.value.trim(); NBS.room = ''; } else NBS.room = pending.value.trim(); }
  const body = { name: NBS.ov.querySelector('#nbs-name').value.trim(), place: NBS.place, room: NBS.room, kind: NBS.ov.querySelector('#nbs-kind').value };
  try {
    if (NBS.id) await apiFetch(`/api/machines/nearby/saved/${encodeURIComponent(NBS.id)}`, { method: 'PUT', body });
    else await apiFetch('/api/machines/nearby/saved', { method: 'POST', body: { ...body, seenId: NBS.seenId } });
    nearbySaveClose();
    nearbyLoad();
  } catch (e) { appAlert(e.message); }
}

/** Remove a saved thing — at once, with Undo (it comes back exactly as it was). */
async function nearbyRemove(id) {
  try {
    const r = await apiFetch(`/api/machines/nearby/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
    nearbyLoad();
    undoToast(`Removed "${r.thing.name}" from ${r.thing.place}${r.thing.room ? ` → ${r.thing.room}` : ''}.`, async () => {
      await apiFetch('/api/machines/nearby/saved/restore', { method: 'POST', body: { thing: r.thing } });
      nearbyLoad();
    });
  } catch (e) { appAlert(e.message); }
}

/** Forget a seen thing: asked first; it is listed again if a later scan sees it. */
function nearbyForget(id) {
  const t = NB.data?.seen.find(x => x.id === id);
  confirmRemove(`"${t?.name || id}" from what was seen`, 'It comes back if a later scan sees it again. Nothing is changed on the thing itself.', async () => {
    try { await apiFetch(`/api/machines/nearby/seen/${encodeURIComponent(id)}`, { method: 'DELETE' }); nearbyLoad(); } catch (e) { appAlert(e.message); }
  }, { verb: 'Forget' });
}

/** Pair a Bluetooth device with this machine: asked first, then each question pairing asks is the person's. */
function nearbyPair(id) {
  const t = NB.data?.seen.find(x => x.id === id);
  if (!t?.bt) return;
  appConfirm(`Pair "${t.name}" (${t.bt}) with this machine's Bluetooth?\n\nPut it in pairing mode first. Once paired it is trusted and connected; you can remove it from this machine's Bluetooth settings.`, async () => {
    try { _nbPairShow(t, await apiFetch('/api/machines/nearby/pair', { method: 'POST', body: { address: t.bt } })); }
    catch (e) { appAlert(e.message); }
  });
}

function _nbPairShow(t, r) {
  const answer = async a => { try { _nbPairShow(t, await apiFetch('/api/machines/nearby/pair/answer', { method: 'POST', body: { address: t.bt, answer: a } })); } catch (e) { appAlert(e.message); } };
  if (r.state === 'confirm') return appConfirm(`${r.message}\n\nPasskey: ${r.passkey}`, () => answer('yes'), () => answer('no'));
  if (r.state === 'pin' || r.state === 'passkey') return appPrompt(r.message, v => answer(v), '', { onCancel: () => answer('') });
  appAlert(r.state === 'paired' ? `Paired with "${t.name}".` : r.message);
  nearbyLoad();
}
