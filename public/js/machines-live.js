/* Machines → Live (modules/machines; TODO H10.9): where the agents are working, as pictures. The agents' computers'
   screens and the pages agents serve for their tests (a dev server a job started, seen through the hub's headless
   browser); whatever is working now — acted in the last moments, or held by a running mission — comes to the front,
   large, and the rest waits behind, small and dim. A computer opens its live view; a served page opens in a tab. It
   refreshes every few seconds while shown, and asks for pictures of served pages only then. Made here: index.html is
   at its line ceiling. */
const ML = { timer: null, data: null };
const ML_MS = 3000;

function liveMachinesTab(shown) {
  clearInterval(ML.timer); ML.timer = null;
  if (!shown) return;
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
  for (const c of d.computers) tiles.push({ id: `c:${c.id}`, working: c.working, kind: '🖵', title: c.name,
    line: c.activity ? `${c.activity.what} · ${_mlAgo(c.activity.ago)}` : c.mission ? `${c.mission.label}: ${c.mission.state}` : c.purpose || '',
    who: c.mission ? c.mission.label : '', img: c.state === 'running' ? `/api/computers/${encodeURIComponent(c.id)}/screen` : null,
    empty: c.state === 'running' ? 'Waiting for its screen…' : `Stopped (${c.state})`, open: `computersWatch(${jsArg(c.id)})` });
  for (const s of d.served) tiles.push({ id: `s:${s.key}`, working: true, kind: '◉', title: `:${s.port}${new URL(s.url).pathname === '/' ? '' : new URL(s.url).pathname}`,
    line: `$ ${s.command.slice(0, 90)}`, who: s.who || '', img: s.shot ? `/api/machines/served/${encodeURIComponent(s.key)}/shot` : null,
    empty: d.browser.found ? 'Taking its picture…' : d.browser.why, tail: s.tail,
    open: `window.open(${jsArg(`${location.protocol === 'https:' ? 'http:' : location.protocol}//${location.hostname}:${s.port}${new URL(s.url).pathname}`)}, '_blank', 'noopener')` });
  return tiles;
}

function _mlDraw(page) {
  const tiles = _mlTiles(), front = tiles.filter(t => t.working), back = tiles.filter(t => !t.working);
  if (!page.querySelector('.ml-front')) {
    page.innerHTML = `<div class="ml-head"><span class="ws-title">Agents' machines, live</span>
      <span class="ws-status">computers and the pages agents serve for tests — whatever is working comes to the front</span></div>
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
      el.setAttribute('onclick', t.open);
      el.querySelector('.ml-cap').innerHTML = `<b>${t.kind} ${escHtml(t.title)}</b>${t.who ? `<span class="ml-who">${escHtml(t.who)}</span>` : ''}<div class="ml-line">${escHtml(t.line)}</div>`;
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
  if (!tiles.length) page.querySelector('.ml-front').innerHTML = '<div class="placeholder">No agent machine and no served page yet. Agents make computers for risky or browser work; a dev server an agent starts shows up here with its page.</div>';
  else page.querySelector('.ml-front > .placeholder')?.remove();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-live' });
  document.getElementById('tab-settings')?.before(page);
});
