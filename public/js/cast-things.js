/* The Cast sheet's devices (modules/cast/things.js; docs/design/cast-reach.md, phase A): the TVs and speakers Nearby
   saved, by place and room, above the screens. A TV shows the page chosen at the top; a speaker says what is typed,
   in this person's Quick call voice. Both go through the hub's cast door, the owner's switch: off, an admin is offered
   it here, anyone else is told who switches it on. */

async function castThingsHtml() {
  let d;
  try { d = await apiFetch('/api/cast/things'); } catch { return ''; }
  if (!d.things.length) return `<div class="input-label">Around you</div>
    <p class="desc">No TV or speaker saved yet: Machines → Nearby finds them on this network (its Cast source), and Save keeps one with its place and room.</p>`;
  const door = d.door.on ? '' : d.door.mayChange
    ? `<div class="cast-door"><p class="desc">TVs and speakers fetch what they are sent over plain HTTP from this hub's address on their network. Switch it on to cast to them: while a cast runs, a door opens to that device alone, for that page or sound — it travels unencrypted on your Wi-Fi.</p>
        <button class="btn btn-sm btn-teal" type="button" onclick="castDoorOn(this)">Cast to devices on this network</button></div>`
    : '<p class="desc">Casting to TVs and speakers is off on this hub: an admin switches it on in this sheet.</p>';
  const groups = {};
  for (const t of d.things) (groups[[t.place, t.room].filter(Boolean).join(' · ') || 'Elsewhere'] ||= []).push(t);
  const row = t => `<div class="cast-target cast-thing" data-thing="${escHtml(t.id)}"><div><b>${t.kind === 'speaker' ? '🔊' : '📺'} ${escHtml(t.name)}</b>
      <br><span class="desc">${escHtml([t.model, t.address].filter(Boolean).join(' · '))}</span>
      ${t.shows ? '' : `<div class="cast-say"><input class="input" placeholder="Say something here…" aria-label="What ${escHtml(t.name)} says" onkeydown="if(event.key==='Enter')castThingSay('${escHtml(t.id)}', this)"></div>`}
      <span class="status-line"></span></div>
    <span class="cast-acts">${t.shows ? `<button class="btn btn-sm btn-teal" type="button" ${d.door.on ? '' : 'disabled'} onclick="castThingShow('${escHtml(t.id)}', this)">Cast</button>`
      : `<button class="btn btn-sm btn-teal" type="button" ${d.door.on ? '' : 'disabled'} onclick="castThingSay('${escHtml(t.id)}', this)">Say</button>`}
      <button class="btn btn-sm" type="button" onclick="castThingStop('${escHtml(t.id)}', this)">Stop</button></span></div>`;
  return `<div class="input-label">Around you</div>${door}${Object.entries(groups).map(([g, list]) =>
    `<div class="cast-room">${escHtml(g)}</div>${list.map(row).join('')}`).join('')}`;
}

const _castThingSay = el => el.closest('.cast-thing')?.querySelector('.status-line');

async function castThingShow(id, btn) {
  const st = _castThingSay(btn), page = document.getElementById('cast-page').value;
  setStatus(st, 'casting…', '');
  try { await apiFetch(`/api/cast/things/${encodeURIComponent(id)}/show`, { method: 'POST', body: { page } }); setStatus(st, '✓ on its screen in a few seconds', 'ok'); }
  catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function castThingSay(id, el) {
  const box = el.closest('.cast-thing'), input = box.querySelector('.cast-say input'), st = _castThingSay(el);
  const text = input?.value.trim();
  if (!text) { input?.focus(); return setStatus(st, 'Write what it says first.', ''); }
  setStatus(st, 'speaking…', '');
  try { await apiFetch(`/api/cast/things/${encodeURIComponent(id)}/say`, { method: 'POST', body: { text } }); input.value = ''; setStatus(st, '✓ said', 'ok'); }
  catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function castThingStop(id, btn) {
  const st = _castThingSay(btn);
  try { await apiFetch(`/api/cast/things/${encodeURIComponent(id)}/stop`, { method: 'POST' }); setStatus(st, 'stopped', ''); }
  catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/** The owner's switch, with the password (auth/guarded.js asks through apiFetch); then the section is drawn again. */
async function castDoorOn(btn) {
  btn.disabled = true;
  try { await apiFetch('/api/cast/door', { method: 'POST', body: { on: true } }); } catch (e) { btn.disabled = false; return appAlert(e.message); }
  const box = document.getElementById('cast-things');
  if (box) box.innerHTML = await castThingsHtml();
}
