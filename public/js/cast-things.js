/* The Cast sheet's devices (modules/cast/things.js; docs/design/cast-reach.md, phase A): the TVs and speakers Nearby
   saved, by place and room, above the screens. A TV shows the page chosen at the top; a speaker says what is typed,
   in this person's Quick call voice. Both go through the hub's cast door, the owner's switch: off, an admin is offered
   it here, anyone else is told who switches it on. */

async function castThingsHtml() {
  let d;
  try { d = await apiFetch('/api/cast/things'); } catch { return ''; }
  if (!d.things.length) return `<div class="input-label">Around you</div>
    <p class="desc">No TV or speaker saved yet: Machines → Nearby finds them on this network (its Cast source), and Save keeps one with its place and room.</p>`;
  const door = castDoorHtml(d.door);
  const groups = {};
  for (const t of d.things) (groups[[t.place, t.room].filter(Boolean).join(' · ') || 'Elsewhere'] ||= []).push(t);
  const row = t => `<div class="cast-target cast-thing" data-thing="${escHtml(t.id)}"><div><b>${t.kind === 'speaker' ? '🔊' : '📺'} ${escHtml(t.name)}</b>
      <br><span class="desc">${escHtml([t.model, t.address].filter(Boolean).join(' · '))}</span>
      ${t.shows ? '' : `<div class="cast-say"><input class="input" placeholder="Say something here…" aria-label="What ${escHtml(t.name)} says" onkeydown="if(event.key==='Enter')castThingSay('${escHtml(t.id)}', this)"></div>`}
      <span class="status-line"></span></div>
    <span class="cast-acts">${t.shows ? `<button class="btn btn-sm btn-teal" type="button" onclick="castThingShow('${escHtml(t.id)}', this)">Cast</button>`
      : `<button class="btn btn-sm btn-teal" type="button" onclick="castThingSay('${escHtml(t.id)}', this)">Say</button>`}
      <button class="btn btn-sm" type="button" onclick="castThingStop('${escHtml(t.id)}', this)">Stop</button></span></div>`;
  return `<div class="input-label">Around you</div>${door}${Object.entries(groups).map(([g, list]) =>
    `<div class="cast-room">${escHtml(g)}</div>${list.map(row).join('')}`).join('')}`;
}

const _castThingSay = el => el.closest('.cast-thing')?.querySelector('.status-line');

async function castThingShow(id, btn) {
  const st = _castThingSay(btn), page = document.getElementById('cast-page').value;
  setStatus(st, 'casting…', '');
  try { await apiFetch(`/api/cast/things/${encodeURIComponent(id)}/show`, { method: 'POST', body: { page } }); setStatus(st, '✓ on its screen in a few seconds', 'ok'); }
  catch (e) { setStatus(st, '', ''); if (switchAsk(e, () => castThingsAgain().then(() => castThingShow(id, document.querySelector(`[data-thing="${id}"] button`))))) return; setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function castThingSay(id, el) {
  const box = el.closest('.cast-thing'), input = box.querySelector('.cast-say input'), st = _castThingSay(el);
  const text = input?.value.trim();
  if (!text) { input?.focus(); return setStatus(st, 'Write what it says first.', ''); }
  setStatus(st, 'speaking…', '');
  try { await apiFetch(`/api/cast/things/${encodeURIComponent(id)}/say`, { method: 'POST', body: { text } }); input.value = ''; setStatus(st, '✓ said', 'ok'); }
  catch (e) {
    setStatus(st, '', '');
    // Switched on, the sheet is drawn again: the sentence goes back in its box and is said.
    if (switchAsk(e, async () => { await castThingsAgain(); const box = document.querySelector(`[data-thing="${id}"]`); const i = box?.querySelector('.cast-say input'); if (i) { i.value = text; castThingSay(id, i); } })) return;
    setStatus(st, `✗ ${e.message}`, 'err');
  }
}

async function castThingStop(id, btn) {
  const st = _castThingSay(btn);
  try { await apiFetch(`/api/cast/things/${encodeURIComponent(id)}/stop`, { method: 'POST' }); setStatus(st, 'stopped', ''); }
  catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/** The cast door's switch, here and on Machines → Nearby: on, what it does; off, the same words and the switch. */
function castDoorHtml(door) {
  if (!door.mayChange) return door.on ? '' : '<p class="desc">Casting to TVs and speakers is off on this hub: an admin switches it on.</p>';
  return `<div class="cast-door"><label class="switch-row"><span class="switch-text">Cast to devices on this network</span>
      <input type="checkbox" class="switch" data-leaf="cast.door"${door.on ? ' checked' : ''} onchange="castDoorSet(this)"></label>
    <p class="desc">TVs and speakers fetch what they are sent over plain HTTP from this hub's address on their network. While a cast runs, a door opens to that device alone, for that page or sound — it travels unencrypted on your Wi-Fi.</p></div>`;
}

/** The owner's switch, with the password (auth/guarded.js asks through the panel's fetch); every copy is drawn again. */
async function castDoorSet(box) {
  const on = box.checked;
  box.disabled = true;
  try { await apiFetch('/api/cast/door', { method: 'POST', body: { on } }); } catch (e) { box.checked = !on; appAlert(e.message); }
  box.disabled = false;
  await castThingsAgain();
}

/** Draw the Cast sheet's devices and Nearby's door card again, where they are on screen. */
async function castThingsAgain() {
  const box = document.getElementById('cast-things');
  if (box) box.innerHTML = await castThingsHtml();
  const card = document.getElementById('nb-cast-door');
  if (card) castDoorCard(card);
}

/** Machines → Nearby's card for the door (settings-find places.js points the search here). */
async function castDoorCard(el) {
  try { const d = await apiFetch('/api/cast/things'); el.innerHTML = `<div class="card-title">Casting to devices on this network</div>${castDoorHtml(d.door)}`; }
  catch { el.remove(); }
}
