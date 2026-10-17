/* Who is working now, and how far each is (modules/workstream/workers.js; asked 2026-10-17). A strip under the
   Workstream's bar, one row per worker: this hub's conversations running a turn (their plan as a bar, the step
   running), other agents' sessions on this machine (their own todo list or plan as a bar when they keep one, else
   what they did: edits, commands, commits, for how long), and processes of note (a build, a test run). Read while the
   page is shown, every 5 s and when the Workstream hears something; nothing is asked of any agent. */
const WSW = { timer: null, list: [], busy: false };

const _wswAgo = ms => (ms == null ? '' : ms < 60e3 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 3600e3 ? `${Math.round(ms / 60e3)} min` : `${(ms / 3600e3).toFixed(1)} h`);
const _wswPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What it did, when it keeps no list of its own: counts from its record, in fixed words. */
function _wswActivity(w) {
  const a = w.activity || {};
  const bits = [];
  if (w.kind === 'outside') {
    if (a.edits) bits.push(_wswPlural(a.edits, 'edit'));
    if (a.commands) bits.push(_wswPlural(a.commands, 'command'));
    if (a.commits) bits.push(_wswPlural(a.commits, 'commit'));
    if (a.files) bits.push(`${_wswPlural(a.files, 'file')} touched`);
  } else if (w.kind === 'doca' && a.steps != null) bits.push(`step ${a.steps}`);
  if (a.sinceMs != null) bits.push(`${w.kind === 'process' ? 'running' : 'for'} ${_wswAgo(a.sinceMs)}`);
  if (a.lastAgoMs != null) bits.push(`last ${_wswAgo(a.lastAgoMs)} ago`);
  return bits.join(' · ');
}

function _wswRow(w) {
  const p = w.progress;
  const bar = p && typeof workProgressBarHtml === 'function' ? workProgressBarHtml(p, { compact: true }) : '';
  const from = p?.from ? `<span class="wsw-from">${escHtml(p.from)}</span>` : '';
  const step = p?.running ? `<div class="wsw-now">step ${p.running.step}: ${escHtml(p.running.title)}</div>` : '';
  return `<div class="wsw-row ${escHtml(w.kind)}">
    <div class="wsw-head"><span class="pt ${w.kind === 'process' ? '' : 'pt-run'}"></span><b class="wsw-name">${escHtml(w.name)}</b>
      <span class="wsw-role">${escHtml([w.role || (w.kind === 'outside' ? 'outside' : ''), w.where].filter(Boolean).join(' · '))}</span></div>
    ${bar ? `<div class="wsw-bar">${bar}${from}</div>` : ''}
    <div class="wsw-act">${escHtml(_wswActivity(w))}</div>
    ${step || (w.now ? `<div class="wsw-now">${escHtml(w.now)}</div>` : '')}</div>`;
}

function workstreamWorkersDraw() {
  const box = document.getElementById('ws-workers');
  if (!box) return;
  box.hidden = !WSW.list.length;
  box.innerHTML = WSW.list.length ? `<div class="wsw-title">Working now</div>${WSW.list.map(_wswRow).join('')}` : '';
}

async function workstreamWorkersLoad() {
  if (WSW.busy) return;
  WSW.busy = true;
  try { WSW.list = (await apiFetch('/api/workstream/workers', { noAsk: true })).workers || []; } catch { WSW.list = []; }
  finally { WSW.busy = false; }
  workstreamWorkersDraw();
}

/** The page shown (or left): read now and every 5 s while it is, stop when it is not. */
function workstreamWorkers(shown) {
  clearInterval(WSW.timer); WSW.timer = null;
  if (!shown) return;
  workstreamWorkersLoad();
  WSW.timer = setInterval(() => { if (document.visibilityState === 'visible') workstreamWorkersLoad(); }, 5000);
}
