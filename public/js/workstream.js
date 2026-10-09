/* Agents → Workstream (modules/workstream; TODO H10.9): the agents' work as it happens, seen rather than reported. The
   file being edited comes to the front by itself, with what the edit added (green) and removed (red) and its count
   (+69 −0); the files touched lately sit above it as chips — click one to keep it, ⟳ to follow the work again. Lower
   right, white on black, each conversation's thinking, the commands it runs and what came back, fading at its edge into
   the file behind. While this page is shown it holds the hub's sentinel, which watches the folders the agents work in;
   leaving it lets go. ⧉ in the chat opens it in a window of its own. Its page is made here: index.html is at its line
   ceiling. */
const WS = { files: [], current: null, follow: true, holding: false, off: null, lines: 0 };

/** Shown or left (nav.js): hold the sentinel while it is shown. */
async function workstreamTab(shown) {
  if (shown) {
    if (!document.getElementById('ws-stage')) _wsFrame();
    if (!WS.off && typeof liveOn === 'function') WS.off = liveOn('workstream', _wsChange);
    await _wsHold(true);
    if (!WS.loaded) {
      WS.loaded = true;
      try {
        const s = await apiFetch('/api/workstream');
        for (const f of s.files) _wsFile(f, true);
        for (const a of s.activity) _wsActivity(a);
        _wsDraw();
      } catch { /* the stream fills it */ }
    }
  } else {
    if (WS.holding) _wsHold(false);
    if (typeof PD !== 'undefined' && PD.open) processesDrawer(false);   // the Processes drawer goes with the page (processes.js)
  }
}

/**
 * Hold the hub's sentinel (or let go). It waits for this page's live stream however long a phone takes to reconnect,
 * says so meanwhile, and when the hub no longer knows the stream (it restarted, or a phone slept past it) opens a new
 * one — whose hello holds again (resync below). It used to give up after four seconds without a word, leaving the
 * last "not watching" on screen while nothing was watched (the owner's phone, 2026-10-10).
 */
async function _wsHold(on) {
  if (on) _wsStatus({ state: 'starting' });
  const screen = on ? await liveReady(15000) : _liveScreen;
  if (!screen) { if (on) { WS.holding = false; _wsStatus({ state: 'offline' }); } return; }
  try {
    const r = await apiFetch('/api/workstream/hold', { method: 'POST', body: { screen, on } });
    WS.holding = r.holding;
    if (on) _wsStatus(r.sentinel);
  } catch (e) {
    WS.holding = false;
    if (!on) return;
    _wsStatus({ state: 'failed', why: e.message });
    if (/no such live stream/i.test(e.message)) liveRestart();
  }
}

function _wsFrame() {
  const page = document.getElementById('tab-workstream');
  page.innerHTML = `<div class="ws-bar"><span class="ws-title">Workstream</span><span class="ws-status" id="ws-status"></span>
      <button class="btn btn-xs" id="ws-follow" onclick="workstreamFollow()" title="Follow the work: the file being edited comes to the front">⟳ following</button>
      <button class="btn btn-xs" onclick="soloOpen('workstream')" title="In a window of its own">⧉</button>${typeof processesButtonHtml === 'function' ? processesButtonHtml() : ''}</div>
    <div class="ws-folders" id="ws-folders" hidden></div>
    <div class="ws-chips" id="ws-chips"></div>
    <div class="ws-stage" id="ws-stage">${emptyStateHtml({ title: 'Nothing edited yet', text: 'When a file changes in a project, the workspace or a folder you watch — whoever edits it: an agent here, an agent outside, you in an editor — it appears here as it changes.' })}</div>
    <div class="ws-console" id="ws-console"></div>`;
}

/** The bar's status: watching how many folders (a tap shows which), connecting, or why not — with a way to try again. */
function _wsStatus(s) {
  const el = document.getElementById('ws-status');
  if (!el || !s) return;
  WS.sentinel = s.on !== undefined ? s : WS.sentinel;
  const retry = ' <button class="btn btn-xs" onclick="_wsHold(true)">Try again</button>';
  el.innerHTML = s.state === 'starting' ? '<span class="pt pt-run"></span> connecting…'
    : s.state === 'offline' ? `<span class="pt"></span> not connected to the hub yet${retry}`
    : s.state === 'failed' ? `<span class="pt pt-err"></span> not watching: ${escHtml(s.why || 'the hub did not answer')}${retry}`
    : s.on ? `<button class="ws-folders-btn" onclick="workstreamFolders()" title="Which folders are watched — and add your own"><span class="pt pt-run"></span> watching ${s.roots.length} folder${s.roots.length === 1 ? '' : 's'} (${s.folders} inside${s.capped ? ', capped' : ''})</button>`
    : '<span class="pt"></span> not watching';
  if (typeof workstreamFoldersDraw === 'function') workstreamFoldersDraw();
}

function _wsChange(c) {
  if (c.what === 'resync') { if (pageShown('workstream')) _wsHold(true); return; }   // a new stream: hold again
  if (c.what === 'file') { _wsFile(c); _wsDraw(); }
  if (c.what === 'activity') _wsActivity(c);
}

/** A file changed: the newest first; it comes to the front unless a file is kept. */
function _wsFile(f, quiet = false) {
  WS.files = [f, ...WS.files.filter(x => x.path !== f.path)].slice(0, 30);
  if (WS.follow || !WS.current) WS.current = f.path;
  if (!quiet && WS.current === f.path) WS.flash = Date.now();
}

const _wsName = p => String(p).split(/[\\/]/).pop();
const _wsCount = f => (f.binary ? 'binary' : f.big ? 'too big to show' : f.deleted ? 'deleted' : `<b class="ws-add">+${f.added || 0}</b> <b class="ws-del">−${f.removed || 0}</b>`);

function _wsDraw() {
  const chips = document.getElementById('ws-chips'), stage = document.getElementById('ws-stage');
  if (!chips || !stage) return;
  chips.innerHTML = WS.files.map(f => `<button class="ws-chip ${f.path === WS.current ? 'active' : ''}${f.by?.by === 'outside' ? ' outside' : ''}" title="${escHtml(f.path)}${f.by ? ` — ${escHtml(f.by.text)}` : ''}" onclick="workstreamShow(${jsArg(f.path)})">
    ${escHtml(_wsName(f.path))} ${_wsCount(f)}</button>`).join('');
  const f = WS.files.find(x => x.path === WS.current);
  if (!f) return;
  const rel = f.root ? f.path.slice(f.root.length + 1) : f.path;
  const note = f.created ? 'new file' : f.unknown ? 'first seen — shown whole' : f.replaced ? 'rewritten' : '';
  const hunks = (f.hunks || []).map(h => `<div class="ws-hunk">${h.lines.map(l => `<div class="ws-line ${l.op === '+' ? 'add' : l.op === '-' ? 'del' : ''}"><span class="ws-n">${l.op === '-' ? '' : l.n}</span><span class="ws-op">${l.op === ' ' ? '' : escHtml(l.op)}</span><span class="ws-code">${escHtml(l.line) || ' '}</span></div>`).join('')}</div>`).join('<div class="ws-gap">⋯</div>');
  stage.innerHTML = `<div class="ws-file-head ${Date.now() - (WS.flash || 0) < 1500 ? 'flash' : ''}"><span class="ws-path">${escHtml(rel)}</span> ${_wsCount(f)}
      ${note ? `<span class="ws-note">${note}</span>` : ''}${f.by ? `<span class="ws-by ${f.by.by === 'outside' ? 'outside' : 'doca'}">${escHtml(f.by.text)}</span>` : ''}<span class="ws-when">${escHtml(new Date(f.at || Date.now()).toLocaleTimeString())}</span></div>
    <div class="ws-code-box">${hunks || `<div class="placeholder">${f.deleted ? 'Deleted.' : f.binary ? 'A binary file.' : f.big ? 'Too big to show here.' : 'No lines changed.'}</div>`}</div>`;
  stage.querySelector('.ws-line.add, .ws-line.del')?.scrollIntoView({ block: 'center' });
}

function workstreamShow(p) { WS.current = p; WS.follow = false; _wsFollowBtn(); _wsDraw(); }
function workstreamFollow() { WS.follow = true; WS.current = WS.files[0]?.path || null; _wsFollowBtn(); _wsDraw(); }
function _wsFollowBtn() { const b = document.getElementById('ws-follow'); if (b) { b.textContent = WS.follow ? '⟳ following' : '⟳ follow the work'; b.classList.toggle('btn-teal', !WS.follow); } }

/** A line of thinking, an answer, a command or what came back — the last 400 kept. */
function _wsActivity(a) {
  const box = document.getElementById('ws-console');
  if (!box) return;
  // The backlog read on opening and the live feed held just before it overlap: each line once.
  const key = `${a.at}|${a.who}|${a.kind}|${a.text}`;
  if ((WS.seenLines ||= new Set()).has(key)) return;
  WS.seenLines.add(key);
  if (WS.seenLines.size > 2000) WS.seenLines = new Set([...WS.seenLines].slice(-800));
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const row = document.createElement('div');
  row.className = `ws-act ${a.kind}${a.failed ? ' failed' : ''}`;
  // A call's risk tier (experiment riskTiers): read, reversible with its way back, or outward — asked.
  const tier = a.tier ? `<span class="ws-tier ${escHtml(a.tier)}" title="${escHtml(a.way ? `Way back: ${a.way}` : a.why || '')}">${escHtml(a.tier)}</span>` : '';
  row.innerHTML = `<span class="ws-who">${escHtml(a.who || '')}</span>${tier}${escHtml(a.text)}${a.way ? `<span class="ws-way"> ↩ ${escHtml(a.way)}</span>` : ''}`;
  box.append(row);
  if (++WS.lines > 400) { box.firstElementChild?.remove(); WS.lines--; }
  if (near) box.scrollTop = box.scrollHeight;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-workstream' });
  document.getElementById('tab-settings')?.before(page);
  // Back from the background (a phone's screen): hold again — the hub may have let go while the stream was away.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && typeof pageShown === 'function' && pageShown('workstream')) _wsHold(true); });
  // ⧉ in the floating chat: the work this chat started, in a window of its own.
  const close = document.querySelector('#chat-panel .chat-header .toolbar-right, .chat-header .toolbar-right');
  if (close) close.prepend(Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: '⧉ Work',
    title: 'Watch the work: files being edited, thinking and commands, in a window of its own',
    onclick: () => soloOpen('workstream') }));
});
