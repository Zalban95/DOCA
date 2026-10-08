/* Machines → Live (modules/machines; TODO H10.9): where the agents are working, as pictures. The agents' computers'
   screens and the pages agents serve for their tests (a dev server a job started, seen through the hub's headless
   browser); whatever is working now — acted in the last moments, or held by a running mission — comes to the front,
   large, and the rest waits behind, small and dim. A computer opens its live view; a served page — on this machine, or
   on a computer's page port (a repository an agent runs there, TODO H10.18) — opens through a preview (canvas origin),
   so a phone reaches it even when it listens on localhost only, and ↗ there gives it a tab of its own. It
   refreshes every few seconds while shown, and asks for pictures of served pages only then. Made here: index.html is
   at its line ceiling. The running VMs are here too (2026-10-08), pictured by their own hypervisor, behind the agents'
   work unless a row of the status column brought them forward (liveFocus); a VM opens its console through the hub.
   Plain containers get no tile: one that serves a page an agent started is already a served page. The VNC targets that
   answer are here too (vnc.js), pictured by the hub's own RFB client; one someone is watching or driving comes to the
   front, and "VMs and VNC in front" keeps them all there. A target that is a running VM's display is that VM's one tile. */
const ML = { timer: null, data: null, previews: {}, focus: null,
  // "VMs in front": how this screen arranges Live, so it is kept in this browser (asked 2026-10-08).
  vmsFront: (() => { try { return localStorage.getItem('doca.live.vmsFront') === '1'; } catch { return false; } })() };   // previews: served key → preview id, made once per page
const ML_MS = 3000;

function liveMachinesTab(shown) {
  clearInterval(ML.timer); ML.timer = null;
  if (!shown) { ML.focus = null; return; }
  _mlLoad();
  ML.timer = setInterval(() => { if (document.visibilityState === 'visible') _mlLoad(); }, ML_MS);
}

async function _mlLoad() {
  const page = document.getElementById('tab-live');
  if (!page) return;
  try { ML.data = await apiFetch('/api/machines?shots=1'); } catch (e) { page.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  _mlDraw(page);
}

const _mlAgo = ms => (ms < 60000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`);

function _mlTiles() {
  const d = ML.data, tiles = [];
  for (const c of d.computers) tiles.push({ id: `c:${c.id}`, working: c.working, kind: '🖵', title: c.name, point: c.state === 'running' ? 'up' : c.state === 'missing' ? 'error' : 'down',
    line: c.activity ? `${c.activity.what} · ${_mlAgo(c.activity.ago)}` : c.mission ? `${c.mission.label}: ${c.mission.state}` : c.purpose || 'no mission yet',
    who: c.mission ? c.mission.label : '', img: c.state === 'running' ? `/api/computers/${encodeURIComponent(c.id)}/screen` : null,
    empty: c.state === 'running' ? 'Waiting for its screen…' : `Stopped (${c.state})`, open: () => computersWatch(c.id), by: c.origin });
  for (const s of d.served) tiles.push({ id: `s:${s.key}`, working: true, kind: '◉',
    title: s.computer ? `${s.who} :${s.inside}` : `:${s.port}${new URL(s.url).pathname === '/' ? '' : new URL(s.url).pathname}`,
    line: `$ ${s.command.slice(0, 90)}`, who: s.who || '', img: s.shot ? `/api/machines/served/${encodeURIComponent(s.key)}/shot` : null,
    empty: d.browser.found ? 'Taking its picture…' : d.browser.why, tail: s.tail,
    open: () => _mlOpenServed(s.key) });
  for (const v of d.vms || []) tiles.push({ id: `v:${v.key}`, working: false, kind: '▣', title: v.name, point: 'up',
    line: [v.label, v.os].filter(Boolean).join(' · '), who: v.console.how === 'hub' ? 'VNC' : '',
    img: v.shot ? `/api/machines/vms/${encodeURIComponent(v.hypervisor)}/${encodeURIComponent(v.name)}/shot` : null,
    empty: v.why || 'Taking its picture…', open: () => vmConsoleOpen(v.hypervisor, v.name), by: v.origin });
  for (const n of d.vnc || []) tiles.push({ id: `n:${n.id}`, working: n.state === 'connected', kind: '◫', title: n.name, point: 'up',
    line: [`${n.host}:${n.port}`, n.same && `${n.same.kind === 'vm' ? 'VM' : 'computer'} ${n.same.name}`].filter(Boolean).join(' · '),
    who: n.state === 'connected' ? (n.driving ? 'someone is driving it' : 'someone is watching it') : 'VNC',
    img: n.shot ? `/api/machines/vnc/${encodeURIComponent(n.id)}/shot` : null, empty: n.why || 'Taking its picture…', open: () => vncConsoleOpen(n.id) });
  for (const t of tiles) if (t.id === ML.focus || (ML.vmsFront && /^[vn]:/.test(t.id))) t.working = true;
  return tiles;
}

/** Keep the running VMs and the VNC screens in the front row (on) or let them sit behind what is working (off); this screen's choice. */
function liveVmsFront(on) {
  ML.vmsFront = !!on;
  try { localStorage.setItem('doca.live.vmsFront', on ? '1' : '0'); } catch { /* a private window: for this visit */ }
  const page = document.getElementById('tab-live');
  if (page && ML.data) _mlDraw(page);
}

/** Live, with one machine brought to the front (a row of the status column, machines-rows.js). */
function liveFocus(id) {
  ML.focus = id;
  nav('live');
  setTimeout(() => document.querySelector(`#tab-live .ml-tile[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 400);
}

/** A served page through a preview (canvas/previews.js): reachable from any screen, whatever address it listens on. */
async function _mlOpenServed(key) {
  const s = ML.data?.served.find(x => x.key === key);
  if (!s) return;
  try {
    if (!ML.previews[key]) {
      const r = await apiFetch('/api/harness/previews', { method: 'POST', body: s.computer ? { computer: s.computer, title: s.who } : { port: s.port, title: s.who || `:${s.port}` } });
      ML.previews[key] = r.preview.id;
    }
    await canvasPreviewOpen(ML.previews[key], s.computer ? '/' : new URL(s.url).pathname);
  } catch (e) { delete ML.previews[key]; appAlert(`Could not open it: ${e.message}`); }
}

function _mlDraw(page) {
  const tiles = _mlTiles(), front = tiles.filter(t => t.working), back = tiles.filter(t => !t.working);
  if (!page.querySelector('.ml-front')) {
    const toggle = `<label class="ml-vms-front" title="Running VMs and VNC screens stay large, beside what is working"><input type="checkbox" class="switch"${ML.vmsFront ? ' checked' : ''} onchange="liveVmsFront(this.checked)"> VMs and VNC in front</label>`;
    page.innerHTML = `<div class="ml-head">${pageHeadHtml({ title: 'Live', sub: 'The agents\' computers, the pages they serve for tests, the running VMs and the VNC screens — whatever is working, or being watched, comes to the front.', actions: toggle })}</div>
      <div class="ml-front"></div><div class="ml-back"></div>`;
  }
  const sync = (box, list, big) => {
    const keep = new Set(list.map(t => t.id));
    box.querySelectorAll('.ml-tile').forEach(el => { if (!keep.has(el.dataset.id)) el.remove(); });
    for (const t of list) {
      let el = box.querySelector(`.ml-tile[data-id="${CSS.escape(t.id)}"]`) || page.querySelector(`.ml-tile[data-id="${CSS.escape(t.id)}"]`);
      if (!el) { el = Object.assign(document.createElement('div'), { className: 'ml-tile' }); el.dataset.id = t.id; el.innerHTML = '<div class="ml-shot"><img alt=""><span class="ml-empty"></span></div><div class="ml-cap"></div>'; }
      el.classList.toggle('big', big);
      el.classList.toggle('working', !!t.working);
      el.onclick = t.open;   // a function: an onclick attribute would read jsArg's HTML escaping literally
      el.classList.toggle('focused', t.id === ML.focus);
      el.querySelector('.ml-cap').innerHTML = `<b>${t.point ? `<span class="m-pt ${t.point}"></span>` : ''}${t.kind} ${escHtml(t.title)}</b>${t.who ? `<span class="ml-who">${escHtml(t.who)}</span>` : ''}<div class="ml-line">${escHtml(t.line)}</div>${t.by ? machineOriginHtml(null, null, t.by) : ''}`;   // who started it (lib/machine-origin.js)
      el.querySelector('.ml-empty').textContent = t.img ? '' : t.empty;
      el.querySelector('.ml-empty').title = t.tail || '';
      const img = el.querySelector('img');
      if (t.img) { const next = new Image(); next.onload = () => { img.src = next.src; img.style.display = ''; }; next.src = `${t.img}?t=${Date.now()}`; }
      else img.style.display = 'none';
      box.append(el);
    }
  };
  sync(page.querySelector('.ml-front'), front, true);
  sync(page.querySelector('.ml-back'), back, false);
  if (!tiles.length) page.querySelector('.ml-front').innerHTML = '<div class="placeholder">No agent machine, served page, running VM or VNC screen yet. Agents make computers for risky or browser work; a dev server an agent starts shows up here with its page; a VM you start shows its screen; a screen added under Machines → VNC shows when it answers.</div>';
  else page.querySelector('.ml-front > .placeholder')?.remove();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-live' });
  document.getElementById('tab-settings')?.before(page);
});
