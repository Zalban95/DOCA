/* Agents → Chronicle (modules/chronicle; TODO P1.13): everything that happened — each turn, mission and device job,
   and for an admin the harness log since the last start — searchable and filtered by source, person, device, agent,
   state and time. Picking one tells its story beside the list (chronicle-story.js). It is where work nobody watched
   is seen afterwards: nothing runs unseen, but it can be unrendered. What is kept, and for how long, is Settings →
   System → Logs. Its page is made here: index.html is at its line ceiling. */
const CHRON = { f: { q: '', source: '', person: '', device: '', agent: '', state: '', since: 'week' }, picked: null, off: null, data: null };
const CHRON_SINCE = { hour: ['the last hour', 3600e3], day: ['the last day', 86400e3], week: ['the last week', 7 * 86400e3], month: ['the last 30 days', 30 * 86400e3], all: ['all kept', 0] };
const CHRON_SOURCES = { turn: 'Turns', mission: 'Missions', job: 'Device jobs', hub: 'What the hub did on its own', call: 'Calls, stage by stage', log: 'Harness log (since the last start)' };
const chronLines = s => s === 'log' || s === 'hub' || s === 'call';   // sources that are lines, not runs

function chronicleTab(shown) {
  if (!shown) { CHRON.off?.(); CHRON.off = null; return; }
  chronicleInit();
  // While shown, a turn starting or ending, or a mission moving, redraws the list — in a burst, once.
  if (!CHRON.off && typeof liveOn === 'function') {
    const redraw = liveDebounce(() => { if (pageShown('chronicle')) chronLoad(); }, 3000);
    const offs = [liveOn('conversation', e => { if (['started', 'ended', 'resync'].includes(e?.what)) redraw(); }), liveOn('missions', redraw)];
    CHRON.off = () => offs.forEach(o => o());
  }
}

function chronicleInit() {
  const page = document.getElementById('tab-chronicle');
  if (!page) return;
  if (!page.dataset.drawn) {
    page.dataset.drawn = '1';
    page.innerHTML = `<div class="chron-bar"><span class="chron-title">Chronicle</span>
        <span class="chron-hint">Everything that happened, and the story of each piece of work: what ran, why, what it cost, what failed.
          ${typeof authHasRight !== 'function' || authHasRight('host') ? 'What is kept, and for how long: <a href="#" onclick="nav(\'settings\');settingsSubNav(\'system\');return false">Settings → System → Logs</a>.' : ''}</span>
        <button class="btn btn-xs" onclick="chronLoad()" title="Read again">↻</button></div>
      <div class="chron-filters" id="chron-filters"></div>
      <div class="chron-totals" id="chron-totals"></div>
      <div class="chron-body"><div class="chron-list" id="chron-list"><div class="chron-empty">Loading…</div></div><div class="chron-story" id="chron-story"></div></div>`;
  }
  chronLoad();
}

function chronQuery() {
  const f = CHRON.f, q = new URLSearchParams();
  for (const k of ['q', 'source', 'person', 'device', 'agent', 'state']) if (f[k]) q.set(k, f[k]);
  const span = CHRON_SINCE[f.since]?.[1];
  if (span) q.set('from', new Date(Date.now() - span).toISOString());
  return q.toString();
}

async function chronLoad() {
  const list = document.getElementById('chron-list');
  if (!list) return;
  let d;
  try { d = await apiFetch(`/api/chronicle?${chronQuery()}`); }
  catch (e) { list.innerHTML = `<div class="chron-empty">${escHtml(e.message)}</div>`; return; }
  CHRON.data = d;
  chronFiltersDraw(d.facets || {});
  const t = d.totals || {}, n = d.total || 0;
  document.getElementById('chron-totals').textContent = chronLines(CHRON.f.source)
    ? `${n} line${n === 1 ? '' : 's'}${n > d.rows.length ? `, the newest ${d.rows.length} shown` : ''}`
    : `${n} run${n === 1 ? '' : 's'}${n > d.rows.length ? `, the newest ${d.rows.length} shown` : ''} · ${(t.tokens || 0).toLocaleString()} tokens`
      + `${t.failed ? ` · ${t.failed} failed` : ''}${t.cancelled ? ` · ${t.cancelled} stopped` : ''}${t.running ? ` · ${t.running} running` : ''}`;
  list.innerHTML = d.rows.map(chronRowHtml).join('') || `<div class="chron-empty">${d.note ? escHtml(d.note) : 'Nothing happened in this range — or nothing that is still kept.'}</div>`;
}

function chronOpt(value, label, cur) { return `<option value="${escHtml(value)}" ${value === cur ? 'selected' : ''}>${escHtml(label)}</option>`; }

function chronFiltersDraw(fc) {
  const el = document.getElementById('chron-filters'), f = CHRON.f;
  if (!el) return;
  const sel = (key, all, items) => `<select class="input" onchange="chronSet('${key}', this.value)">${chronOpt('', all, f[key])}${items.join('')}</select>`;
  const focused = document.activeElement?.id === 'chron-q';
  el.innerHTML = `<input class="input" id="chron-q" placeholder="Search titles, outcomes, agents, devices…" value="${escHtml(f.q)}" oninput="chronSearch(this.value)">
    ${sel('source', 'every source', (fc.sources || Object.keys(CHRON_SOURCES)).map(s => chronOpt(s, CHRON_SOURCES[s] || s, f.source)))}
    ${chronLines(f.source) ? '' : sel('person', 'everyone', (fc.people || []).map(p => chronOpt(p.id, p.name, f.person)))}
    ${chronLines(f.source) ? '' : sel('device', 'every device', (fc.devices || []).map(d => chronOpt(d.id, d.name, f.device)))}
    ${chronLines(f.source) ? '' : sel('agent', 'every agent', (fc.agents || []).map(a => chronOpt(a.id, a.label, f.agent)))}
    ${sel('state', chronLines(f.source) ? 'every level' : 'every outcome', (fc.states || []).map(s => chronOpt(s, s, f.state)))}
    <select class="input" onchange="chronSet('since', this.value)">${Object.entries(CHRON_SINCE).map(([k, [l]]) => chronOpt(k, l, f.since)).join('')}</select>`;
  if (focused) { const q = document.getElementById('chron-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

function chronSet(key, value) {
  CHRON.f[key] = value;
  if (key === 'source') CHRON.f.state = '';   // a run's outcome and a line's level are different words
  chronLoad();
}

let _chronSearchTimer = null;
function chronSearch(v) { clearTimeout(_chronSearchTimer); _chronSearchTimer = setTimeout(() => chronSet('q', v), 300); }

const chronWhen = at => { const d = new Date(at); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
function chronDur(ms) { if (ms == null) return ''; if (ms < 1000) return `${ms} ms`; if (ms < 60e3) return `${(ms / 1000).toFixed(1)} s`; return `${Math.round(ms / 60e3)} min`; }

function chronRowHtml(r) {
  if (chronLines(r.source)) return `<div class="chron-row" ${r.sessionId ? `onclick="chronStory({session: ${jsArg(r.sessionId)}}, this)"` : ''}>
      <span class="chron-when" title="${escHtml(new Date(r.at).toLocaleString())}">${escHtml(chronWhen(r.at))}</span>
      <span class="chron-what" style="white-space:normal">${escHtml(r.text)}</span><span class="chron-state ${escHtml(r.level)}">${escHtml(r.level)}</span></div>`;
  const icon = { turn: '💬', mission: '⬡', job: '⌁' }[r.source] || '·';
  const meta = [r.agent?.label, r.person?.name, r.device && `from ${r.device.name}`, r.steps != null && `${r.steps} step${r.steps === 1 ? '' : 's'}`,
    r.tokens != null && `${r.tokens.toLocaleString()} tokens`, chronDur(r.ms), r.outcome].filter(Boolean).join(' · ');
  return `<div class="chron-row ${CHRON.picked === r.id ? 'active' : ''}" onclick="chronStory({run: ${jsArg(r.id)}}, this)">
    <span class="chron-when" title="${escHtml(new Date(r.at).toLocaleString())}">${escHtml(chronWhen(r.at))}</span>
    <span class="chron-what">${icon} ${escHtml(r.title || r.id)}</span><span class="chron-state ${escHtml(r.state)}">${escHtml(r.state)}</span>
    <span class="chron-meta" title="${escHtml(meta)}">${escHtml(meta)}</span></div>`;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-chronicle' });
  document.getElementById('tab-settings')?.before(page);
});
