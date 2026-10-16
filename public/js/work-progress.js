/* How far each job is (modules/harness/plan-progress.js; improvement B, 2026-10-16): the steps of its plan done of its
   steps — a step with a check is done only once the check held — as a bar with N/M and a percentage, and the step
   running now. Mechanical: the hub works it out from the plan; nothing here guesses. Drawn in three places from one
   read (GET /api/harness/progress): the status column (a "Work" section above Machines), the Workstream (a row per job
   under its bar) and a project's chat tabs (projects/chat-tabs.js reads each chat's own `progress`). Re-read only when
   the live feed says a plan or a mission changed — never on a timer. */
const WP = { jobs: [], loaded: false, off: [] };

/** A bar and its numbers, for any job's `progress` {done, total, percent, running, failing}. */
function workProgressBarHtml(p, { compact = false } = {}) {
  if (!p) return '';
  const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
  const tip = `${p.done} of ${p.total} steps done${p.checked ? ` (${p.checked} checked by the hub)` : ''}${p.running ? ` — step ${p.running.step} running: ${p.running.title}` : ''}${p.failing ? ` — step ${p.failing.step}'s check fails: ${p.failing.why}` : ''}`;
  return `<span class="wp${p.failing ? ' failing' : ''}${p.fulfilled ? ' full' : ''}${compact ? ' compact' : ''}" title="${escHtml(tip)}">`
    + `<span class="wp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span class="wp-fill" style="width:${pct}%"></span></span>`
    + `<span class="wp-n">${p.done}/${p.total} · ${pct}%</span></span>`;
}

/** The line under a job: the step running now, or the check that keeps a step open. */
function workProgressNoteHtml(p) {
  if (!p) return '';
  if (p.failing) return `<div class="wp-note fail"><span class="pt pt-err"></span> step ${p.failing.step}: ${escHtml(p.failing.why)}</div>`;
  if (p.running) return `<div class="wp-note"><span class="pt pt-run"></span> step ${p.running.step}: ${escHtml(p.running.title)}</div>`;
  if (p.fulfilled) return '<div class="wp-note">every step done</div>';
  return '';
}

async function workProgressLoad() {
  try { WP.jobs = (await apiFetch('/api/harness/progress')).jobs || []; } catch { return; }
  WP.loaded = true;
  _wpSidebar();
  workProgressWorkstream();
}

function workProgressOpen(id) {
  nav('harness');
  if (typeof hcOpenSession === 'function') hcOpenSession(id);
}

/** The status column: a compact row per job, hidden while none has a plan under way. */
function _wpSidebar() {
  const sec = document.querySelector('.sidebar-section[data-section="work"]'), box = document.getElementById('s-work');
  if (!sec || !box) return;
  sec.hidden = !WP.jobs.length;
  const count = document.getElementById('s-work-count');
  if (count) count.textContent = WP.jobs.length ? String(WP.jobs.length) : '';
  box.innerHTML = WP.jobs.map(j => `<div class="c-item m-row wp-row${j.running ? ' running' : ''}" onclick="workProgressOpen(${jsArg(j.id)})" title="${escHtml(j.title)}">
      <div class="m-main"><span class="c-name">${escHtml(j.title)}</span>${workProgressBarHtml(j.progress, { compact: true })}
      ${j.progress?.failing ? `<span class="m-detail fail">step ${j.progress.failing.step}'s check fails</span>` : j.progress?.running ? `<span class="m-detail">step ${j.progress.running.step}: ${escHtml(j.progress.running.title)}</span>` : ''}</div></div>`).join('');
}

/** The Workstream: a row per job under its bar, drawn when the page has its frame. */
function workProgressWorkstream() {
  const box = document.getElementById('ws-progress');
  if (!box) return;
  box.hidden = !WP.jobs.length;
  box.innerHTML = WP.jobs.map(j => `<div class="ws-job" onclick="workProgressOpen(${jsArg(j.id)})">
      <span class="ws-job-title">${j.running ? '<span class="pt pt-run"></span> ' : ''}${escHtml(j.title)}${j.kind === 'mission' ? ' <span class="desc">specialist</span>' : ''}</span>
      ${workProgressBarHtml(j.progress)}${workProgressNoteHtml(j.progress)}</div>`).join('');
}

const _wpReload = typeof liveDebounce === 'function' ? liveDebounce(() => {
  workProgressLoad();
  if (typeof pageShown === 'function' && pageShown('projects') && typeof pjTabsSync === 'function') pjTabsSync({ quiet: true });
}, 800) : () => {};

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const side = document.querySelector('aside.sidebar');
  if (side && !side.querySelector('[data-section="work"]')) {
    const sec = Object.assign(document.createElement('div'), { className: 'sidebar-section', hidden: true });
    sec.dataset.section = 'work';
    sec.innerHTML = '<div class="sec-label">Work <span id="s-work-count" style="font-size:9px;opacity:.6"></span></div><div id="s-work"></div>';
    side.prepend(sec);
  }
  if (typeof liveOn === 'function') WP.off = [liveOn('progress', _wpReload), liveOn('missions', _wpReload)];
  // The first read waits for the signed-in panel (the sign-in page loads no scripts of this kind).
  setTimeout(workProgressLoad, 1500);
});
