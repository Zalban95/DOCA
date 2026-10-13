/* Machines → Nearby → Look from (modules/nearby/lookers.js; R3f, the owner's yes of 2026-10-13): this hub, or one of
   your own clients that lends Nearby and is connected now — a desk at home while the hub is elsewhere. A chip row under
   the sources; Scan asks the one chosen (kept per browser), and each thing says who saw it. */
let _nbFrom = 'hub';
try { _nbFrom = localStorage.getItem('doca.nearby.from') || 'hub'; } catch { /* per browser only */ }

function nearbyFromDraw(page) {
  const d = NB.data, card = page.querySelector('.nb-sources')?.closest('.card');
  if (!card) return;
  let row = card.querySelector('.nb-from');
  if (!row) { row = Object.assign(document.createElement('div'), { className: 'nb-from' }); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px'; card.querySelector('.card-title').after(row); }
  const lookers = d.lookers || [{ id: 'hub', label: 'This hub' }];
  if (!lookers.some(l => l.id === _nbFrom)) _nbFrom = 'hub';
  row.innerHTML = `<span class="desc">Look from</span>${lookers.map(l => `<button type="button" class="btn btn-xs${l.id === _nbFrom ? ' btn-primary' : ''}" aria-pressed="${l.id === _nbFrom}"
      onclick="nearbyFrom(${jsArg(l.id)})" title="${escHtml(l.kind === 'client' ? 'Your device scans its own network and radio, with what it lends' : 'This hub, with the sources switched on below')}">${escHtml(l.label)}</button>`).join('')}
    ${(d.lookersWaiting || []).map(w => `<button type="button" class="btn btn-xs" disabled title="${escHtml(`${w.label}: ${w.why}`)}" style="opacity:.55">${escHtml(w.label)}</button>
      <span class="desc">${escHtml(w.why)}</span>${w.askable ? `<button type="button" class="btn btn-xs" onclick="nearbyFromAsk(${jsArg(w.deviceId)}, this)">Ask on it</button>` : ''}`).join('')}
    ${lookers.length < 2 && !(d.lookersWaiting || []).length ? `<span class="desc">${infoBtn('A device of yours (DocaMobile, DocaDesk, doca-client) lends Nearby once you say yes to its nearby family; while it is connected it appears here, and Scan looks from where it is.')}</span>` : ''}`;
  // A client looks with its own readers, not the hub's switches: those are hidden while it is chosen, and said instead.
  const client = lookers.find(l => l.id === _nbFrom && l.kind === 'client');
  card.querySelector('.nb-sources').style.display = client ? 'none' : '';   // its CSS grid beats `hidden`
  let note = card.querySelector('.nb-from-note');
  if (!note) { note = Object.assign(document.createElement('p'), { className: 'desc nb-from-note' }); row.after(note); }
  note.style.display = client ? '' : 'none';
  if (client) note.textContent = `${client.label} looks with what it lends: Cast devices, Bonjour, UPnP / DLNA, its network neighbours and Bluetooth — on its own network. `;
  const scanBtn = page.querySelector('.nb-scan');
  if (scanBtn && !d.scanning && client) scanBtn.disabled = false;   // a client scans with its own sources
}

/** Ask the device's person, on the device, to allow Nearby (device.control `ask`; devices-hands.js asks the same way). */
async function nearbyFromAsk(deviceId, btn) {
  btn.disabled = true; btn.textContent = 'Asked…';
  try {
    await apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/control`, { method: 'POST', body: { action: 'ask', family: 'nearby' } });
    btn.textContent = 'Asked — answer on the device';
  } catch (e) { btn.disabled = false; btn.textContent = 'Ask on it'; btn.title = e.message; btn.after(Object.assign(document.createElement('span'), { className: 'desc', textContent: ` ✗ ${e.message}` })); }
}

function nearbyFrom(id) {
  _nbFrom = id;
  try { localStorage.setItem('doca.nearby.from', id); } catch { /* per browser only */ }
  nearbyFromDraw(document.getElementById('tab-nearby'));
}

/** "from the hub 2 min ago · from Al's desk 3 h ago" */
const nearbySeenFrom = t => (t.seenFrom || []).map(x => `from ${x.by === 'hub' ? 'the hub' : x.label || 'a device'} ${_nbAgo(x.at)}`).join(' · ');
