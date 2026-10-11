/* Machines → Nearby (modules/nearby; asked 2026-10-12: "a drop-down with the devices seen from catt, bt, wifi and whatever
   else, all of these can be enabled and the seen devices paired or saved … devices could be added in home, lab, any
   room"). Three cards: the sources, each a switch with one sentence on what it looks at (all off until the person turns
   them on); what was saved, by place and then room; and everything seen, filtered by kind, source or words, each with
   Save…, its page, Pair (Bluetooth) and Forget. "Devices" stays the word for DOCA's paired clients: these are things.
   The save dialog and pairing are nearby-save.js. The page is made here: index.html is at its ceiling. */
const NB = { data: null, timer: null, f: { kind: '', source: '', q: '' } };

const NB_KIND = { tv: 'TV', speaker: 'Speaker', printer: 'Printer', phone: 'Phone', computer: 'Computer', light: 'Light', router: 'Router', storage: 'Storage',
  camera: 'Camera', headphones: 'Headphones', watch: 'Watch', accessory: 'Accessory', smart: 'Smart device', unknown: 'Unknown' };
const NB_SOURCE = { cast: 'Cast', mdns: 'Bonjour', ssdp: 'UPnP', lan: 'Network', bluetooth: 'Bluetooth', homeassistant: 'Home Assistant', tailscale: 'Tailnet' };
const NB_CAN = { cast: 'cast', airplay: 'AirPlay', 'airplay-audio': 'AirPlay audio', 'dlna-play': 'DLNA play', print: 'print', web: 'web page', ssh: 'SSH', files: 'files',
  vnc: 'VNC', homekit: 'HomeKit', spotify: 'Spotify Connect', 'bluetooth-audio': 'Bluetooth audio', bluetooth: 'Bluetooth', 'home-assistant': 'Home Assistant', tailnet: 'tailnet' };

function nearbyTab(shown) {
  clearInterval(NB.timer); NB.timer = null;
  if (!shown) return;
  nearbyLoad();
  NB.timer = setInterval(() => { if (document.visibilityState === 'visible' && NB.data?.scanning) nearbyLoad(); }, 4000);
}

function _nbAgo(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? 'just now' : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

async function nearbyLoad() {
  const page = document.getElementById('tab-nearby');
  if (!page) return;
  if (!page.querySelector('.nb-sources')) {
    page.innerHTML = `${pageHeadHtml({ title: 'Nearby', sub: 'Speakers, TVs, printers, lights and computers around this hub — seen by the sources you switch on, saved by place and room. The agent reads what you save, and how to use each.',
      actions: '<button class="btn btn-sm btn-primary nb-scan" onclick="nearbyScan(this)">Scan</button>' })}
      <div class="card mb8"><div class="card-title">Look for things around this hub</div><div class="nb-sources"></div><div class="nb-more"></div></div>
      <div class="card mb8"><div class="card-title">Saved</div><div class="nb-saved"></div></div>
      <div class="card"><div class="card-title">Seen</div><div class="nb-filter"></div><div class="nb-seen"><div class="placeholder pulse">Loading…</div></div></div>`;
  }
  try { NB.data = await apiFetch('/api/machines/nearby'); }
  catch (e) { page.querySelector('.nb-seen').innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  _nbDraw(page);
}

function _nbDraw(page) {
  const d = NB.data;
  page.querySelector('.nb-sources').innerHTML = d.sources.map(s => `<label class="nb-source${s.works ? '' : ' off'}">
      <input type="checkbox" class="switch" ${s.on ? 'checked' : ''} ${s.works ? '' : 'disabled'} aria-label="${escHtml(s.label)}" onchange="nearbySource(${jsArg(s.id)}, this.checked)">
      <span class="nb-source-text"><b>${escHtml(s.label)}</b><span class="desc">${escHtml(s.works ? s.about : `${s.about} ${s.why}`)}</span></span></label>`).join('');
  const more = page.querySelector('.nb-more');
  if (!more.querySelector('details')) {
    more.innerHTML = advancedFold(`<div class="nb-every"><label><span class="input-label">Scan by itself every${infoBtn('Minutes between scans the hub makes on its own, with the sources that are on; each is a line in the activity log (Agents → Chronicle). 0: only when someone presses Scan or the agent asks.')}</span>
        <input class="input" id="nb-every" type="number" min="0" max="1440" data-default="0" value="${d.everyMin || 0}"> minutes</label>
        <button class="btn btn-xs" onclick="nearbySchedule()">Save</button></div>
      <div class="nb-io"><a class="btn btn-xs" href="/api/machines/nearby/export" download="nearby-things.json">Export saved</a>
        <label class="btn btn-xs">Import…<input type="file" accept="application/json,.json" hidden onchange="nearbyImport(this)"></label></div>`, { id: 'nearby-more', count: 2 });
  }
  const scanBtn = page.querySelector('.nb-scan');
  if (scanBtn) { scanBtn.disabled = !!d.scanning || !d.sources.some(s => s.on && s.works); scanBtn.textContent = d.scanning ? 'Scanning…' : 'Scan'; }
  _nbSavedDraw(page);
  _nbSeenDraw(page);
}

const _nbCanChips = t => (t.can || []).filter(c => c !== 'bluetooth').map(c => `<span class="nb-chip">${escHtml(NB_CAN[c] || c)}</span>`).join('');

function _nbSavedDraw(page) {
  const list = NB.data.saved;
  const host = page.querySelector('.nb-saved');
  if (!list.length) { host.innerHTML = '<div class="placeholder">Nothing saved yet. Save… on a thing below gives it a name of yours, a place and a room — Home → Living room, Lab, Office — and the agent knows it from then on.</div>'; return; }
  const places = [...new Set(list.map(t => t.place))];
  host.innerHTML = places.map(p => {
    const inPlace = list.filter(t => t.place === p);
    const rooms = [...new Set(inPlace.map(t => t.room || ''))];
    return `<div class="nb-place"><div class="nb-place-name">${escHtml(p)}</div>${rooms.map(r => `<div class="nb-room">${r ? `<div class="nb-room-name">${escHtml(r)}</div>` : ''}
      ${inPlace.filter(t => (t.room || '') === r).map(_nbSavedRow).join('')}</div>`).join('')}</div>`;
  }).join('');
}

function _nbSavedRow(t) {
  const id = jsArg(t.id);
  return `<div class="nb-row"><span class="m-pt ${t.lastSeen && Date.now() - Date.parse(t.lastSeen) < 86400000 ? 'up' : 'down'}" title="last seen ${escHtml(_nbAgo(t.lastSeen))}"></span>
    <span class="nb-name">${escHtml(t.name)}<span class="nb-sub">${escHtml(NB_KIND[t.kind] || t.kind)}${t.model ? ` · ${escHtml(t.model)}` : ''}${t.addresses?.length ? ` · ${escHtml(t.addresses[0])}` : ''} · seen ${escHtml(_nbAgo(t.lastSeen))}</span></span>
    <span class="nb-cans">${_nbCanChips(t)}</span>
    ${rowActs([t.web && { icon: 'solo', label: 'Open its page', onclick: `window.open(${jsArg(t.web)}, '_blank', 'noopener')` },
      { icon: 'edit', label: 'Rename or move', onclick: `nearbySaveOpen(null, ${id})` },
      { icon: 'remove', label: 'Remove', more: true, onclick: `nearbyRemove(${id})` }])}</div>`;
}

function _nbSeenDraw(page) {
  const d = NB.data, f = NB.f;
  const kinds = [...new Set(d.seen.map(t => t.kind))].sort(), sources = [...new Set(d.seen.flatMap(t => t.sources || []))].sort();
  const fhost = page.querySelector('.nb-filter');
  if (!fhost.querySelector('input')) {
    fhost.innerHTML = `<div class="nb-filters"><select class="input nb-f-kind" aria-label="Kind" onchange="NB.f.kind=this.value; _nbSeenDraw(document.getElementById('tab-nearby'))"></select>
      <select class="input nb-f-source" aria-label="Seen by" onchange="NB.f.source=this.value; _nbSeenDraw(document.getElementById('tab-nearby'))"></select>
      <input class="input nb-f-q" type="search" placeholder="Search names, makers, addresses…" aria-label="Search" oninput="NB.f.q=this.value; _nbSeenDraw(document.getElementById('tab-nearby'))"></div>`;
  }
  fhost.querySelector('.nb-f-kind').innerHTML = `<option value="">Every kind</option>${kinds.map(k => `<option value="${escHtml(k)}"${k === f.kind ? ' selected' : ''}>${escHtml(NB_KIND[k] || k)}</option>`).join('')}`;
  fhost.querySelector('.nb-f-source').innerHTML = `<option value="">Seen by any source</option>${sources.map(s => `<option value="${escHtml(s)}"${s === f.source ? ' selected' : ''}>${escHtml(NB_SOURCE[s] || s)}</option>`).join('')}`;
  const savedIds = new Set(d.saved.map(t => t.seenId).filter(Boolean));
  const q = f.q.trim().toLowerCase();
  const rows = d.seen.filter(t => (!f.kind || t.kind === f.kind) && (!f.source || (t.sources || []).includes(f.source))
    && (!q || [t.name, t.maker, t.model, ...(t.addresses || []), t.mac, t.bt].join(' ').toLowerCase().includes(q)));
  const host = page.querySelector('.nb-seen');
  const scan = d.lastScan;
  const misses = scan?.why ? Object.entries(scan.why).map(([s, w]) => `${NB_SOURCE[s] || s}: ${w}`) : [];
  const head = scan ? `<div class="desc nb-last">Last scan ${escHtml(_nbAgo(scan.at))}: ${scan.found} found with ${escHtml((scan.sources || []).map(s => NB_SOURCE[s] || s).join(', '))}.${misses.length ? ` ${escHtml(misses.join(' · '))}` : ''}</div>` : '';
  fhost.hidden = !d.seen.length;
  if (!d.seen.length) {
    host.innerHTML = d.sources.some(s => s.on) ? emptyStateHtml({ title: 'Nothing seen yet', text: 'Scan looks now with the sources that are on.', action: { label: 'Scan', onclick: 'nearbyScan()' } })
      : emptyStateHtml({ title: 'Nothing is looked for yet', text: 'Switch on the sources above that you want: nothing scans your network or the air around this machine until you do.' });
    return;
  }
  host.innerHTML = head + (rows.length ? rows.map(t => _nbSeenRow(t, savedIds.has(t.id))).join('') : '<div class="placeholder">Nothing seen matches.</div>');
}

function _nbSeenRow(t, isSaved) {
  const id = jsArg(t.id);
  const sub = [NB_KIND[t.kind] || t.kind, t.model || t.maker || (t.private ? 'private address — a phone, tablet or laptop hiding its maker' : t.mac ? 'unknown maker' : ''),
    (t.addresses || []).slice(0, 2).join(', '), t.bt, ...(t.details || [])].filter(Boolean).join(' · ');
  const canPair = t.bt && !t.paired && NB.data.platform === 'linux';
  return `<div class="nb-row"><span class="m-pt ${Date.now() - Date.parse(t.lastSeen) < 3600000 ? 'up' : 'down'}"></span>
    <span class="nb-name"><span>${escHtml(t.name)}${isSaved ? ' <span class="nb-chip nb-saved-chip">saved</span>' : ''}</span><span class="nb-sub">${escHtml(sub)}</span>
      <span class="nb-sub">by ${escHtml((t.sources || []).map(s => NB_SOURCE[s] || s).join(', '))} · first ${escHtml(_nbAgo(t.firstSeen))}, last ${escHtml(_nbAgo(t.lastSeen))}</span></span>
    <span class="nb-cans">${_nbCanChips(t)}</span>
    <span class="nb-acts">${isSaved ? '' : `<button class="btn btn-xs btn-blue" onclick="nearbySaveOpen(${id})">Save…</button>`}
      ${canPair ? `<button class="btn btn-xs" title="Pair it with this machine's Bluetooth" onclick="nearbyPair(${id})">Pair</button>` : ''}
      ${rowActs([t.web && { icon: 'solo', label: 'Open its page', onclick: `window.open(${jsArg(t.web)}, '_blank', 'noopener')` },
        { icon: 'remove', label: 'Forget', more: true, onclick: `nearbyForget(${id})` }])}</span></div>`;
}

async function nearbySource(id, on) {
  try { NB.data = await apiFetch('/api/machines/nearby/sources', { method: 'POST', body: { id, on } }); _nbDraw(document.getElementById('tab-nearby')); }
  catch (e) { appAlert(e.message); nearbyLoad(); }
}

async function nearbyScan(btn) {
  const b = btn || document.querySelector('#tab-nearby .nb-scan');
  if (b) { b.disabled = true; b.textContent = 'Scanning…'; }
  try { NB.data = await apiFetch('/api/machines/nearby/scan', { method: 'POST', body: {} }); }
  catch (e) { appAlert(e.message); }
  nearbyLoad();
}

async function nearbySchedule() {
  try { NB.data = await apiFetch('/api/machines/nearby/schedule', { method: 'POST', body: { everyMin: Number(document.getElementById('nb-every').value) || 0 } }); appAlert(NB.data.everyMin ? `It scans by itself every ${NB.data.everyMin} minutes.` : 'It scans only when asked.'); }
  catch (e) { appAlert(e.message); }
}

async function nearbyImport(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try { const r = await apiFetch('/api/machines/nearby/import', { method: 'POST', body: JSON.parse(await file.text()) }); appAlert(`${r.added} added${r.skipped ? `, ${r.skipped} already saved` : ''}.`); }
  catch (e) { appAlert(e.message); }
  nearbyLoad();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-nearby' });
  document.getElementById('tab-settings')?.before(page);
});
