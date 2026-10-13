/* ═══════════════════════════════════════════════════════
   Settings → Set-up: "Install everything" (modules/guided/run.js). One password,
   asked once and checked by sudo before anything starts; the hub then installs
   this machine's tools one at a time and the rest side by side once what they
   need is in. Each row says where it stands; the page can close meanwhile.
   ═══════════════════════════════════════════════════════ */

let _guidedRunTimer = null;
const _GUIDED_RUN_WORDS = { waiting: 'waiting', running: 'installing…', installed: '✓ installed', failed: '✗', skipped: '—' };

/** The installs waiting, once each: a model serving two roles is one proposal. */
function _guidedPending(p) {
  const seen = new Set();
  return p.steps.filter(s => s.type === 'install' && s.proposal?.status === 'pending' && !seen.has(s.proposal.id) && seen.add(s.proposal.id));
}

/** The button above the rows, when something is waiting to be installed. */
function guidedRunButtonHtml(p) {
  const pending = _guidedPending(p);
  if (pending.length < 2) return '';
  const pw = pending.some(s => s.proposal.needsPassword);
  return `<div class="toolbar"><button class="btn btn-sm btn-green" id="guided-run-btn" onclick="guidedRunAll(${pw ? 'true' : 'false'})">Install everything (${pending.length})</button>
    <span class="guided-muted">${pw ? 'Your password is asked once. ' : ''}This machine's tools go one after another; models and services start as soon as what they need is in.</span>
    <span class="status-line" id="guided-run-st"></span></div>`;
}

/** Asked first, like every install (lib/install-ask.js): what each one is and what it downloads; then the password. */
function guidedRunAll(needsPassword) {
  const pending = _guidedPending(_guidedLastPlan || { steps: [] });
  const size = s => installSize(s.kind, s.id, s.diskGB ? `about ${s.diskGB} GB` : null) || 'size not known here';
  appConfirm(`Install these ${pending.length} on this machine?\n\n${pending.map(s => `• ${s.label} — ${size(s)}`).join('\n')}\n\nThis machine's tools go one after another; models and services start as soon as what they need is in.`,
    () => guidedRunGo(needsPassword));
}

function guidedRunGo(needsPassword) {
  const go = async password => {
    const st = document.getElementById('guided-run-st');
    try {
      const r = await fetch('/api/guided/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(password ? { password } : {}) });
      const j = await r.json();
      if (!r.ok) {
        if (j.code === 'password_refused') { setStatus(st, `✗ ${j.error}`, 'err'); return guidedRunGo(true); }
        return setStatus(st, `✗ ${j.error}`, 'err');
      }
      guidedRunShow(j.run);
    } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
  };
  if (needsPassword && typeof sudoAsk === 'function') sudoAsk('Setting up installs a few things that need administrator rights — asked once for all of them.', pw => { if (pw != null) go(pw); });
  else go();
}

/** Each row's state from the run; polled while it runs and this page shows it. */
function guidedRunShow(run) {
  clearTimeout(_guidedRunTimer);
  if (!run) return;
  const steps = (typeof _guidedLastPlan !== 'undefined' && _guidedLastPlan?.steps) || [];
  for (const it of run.items) {
    const i = steps.findIndex(s => s.proposal?.id === it.proposalId);
    const st = i >= 0 && document.getElementById(`guided-st-${i}`);
    if (!st) continue;
    st.previousElementSibling?.matches?.('button') && (st.previousElementSibling.disabled = it.state !== 'failed');
    setStatus(st, `${_GUIDED_RUN_WORDS[it.state] || it.state}${it.error ? ` ${it.error}` : ''}`, it.state === 'installed' ? 'ok' : it.state === 'failed' || it.state === 'skipped' ? 'err' : '');
    if (it.state === 'installed') { const use = document.getElementById(`guided-use-${i}`); if (use) use.style.display = ''; }
  }
  const btn = document.getElementById('guided-run-btn');
  if (btn) btn.disabled = run.running;
  const n = s => run.items.filter(i => i.state === s).length;
  setStatus(document.getElementById('guided-run-st'), run.running ? `${n('installed')} of ${run.items.length} installed…`
    : `${n('installed')} installed${n('failed') ? `, ${n('failed')} failed` : ''}${n('skipped') ? `, ${n('skipped')} not started` : ''}`, run.running ? '' : n('failed') || n('skipped') ? 'err' : 'ok');
  if (run.running) _guidedRunTimer = setTimeout(async () => {
    if (!document.getElementById('guided-plan')) return;
    try { guidedRunShow((await apiFetch('/api/guided/run')).run); } catch { /* the next look */ }
  }, 2000);
}

/** A run already going (the page was reopened): drawn into the rows. */
async function guidedRunResume() {
  try { const { run } = await apiFetch('/api/guided/run'); if (run) guidedRunShow(run); } catch { /* none */ }
}
