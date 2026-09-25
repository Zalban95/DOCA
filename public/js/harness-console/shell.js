/* ═══════════════════════════════════════════════════════
   Harness tab: the default harness's workspace — the turn in
   flight, the session state, and building the shell for the harness.
   ═══════════════════════════════════════════════════════ */

/* The turn in flight in the Harness tab. Stop hangs up on the stream and the
   server ties the response closing to the turn's AbortController. */
let _hcTurn = null;

function hcStop() {
  if (!_hcTurn) return;
  _hcTurn.abort();
  const btn = document.getElementById('hc-send');
  const stopBtn = document.getElementById('hc-stop');
  if (btn) btn.style.display = '';
  if (stopBtn) stopBtn.style.display = 'none';
}

let _hcSession  = null;
let _hcMainSession = null;
let _hcArchived = false;
let _hcOrgPoll = null;
let _hcSelected = null;
let _hcBusy     = false;
let _hcRendered = null;   // harness id the shell is currently built for

function harnessTabInit() {
  if (!_harnesses.length) harnessLoad().then(_harnessConsoleBuild);
  else _harnessConsoleBuild();
}

function _harnessConsoleReset() {
  _hcRendered = null;
  _harnessTermClose();
  if (currentTab === 'harness') _harnessConsoleBuild();
}

function _harnessConsoleBuild() {
  const shell = document.getElementById('harness-console-shell');
  if (!shell) return;
  const h = _harnesses.find(x => x.isDefault);
  if (!h) { shell.innerHTML = '<div class="placeholder">No harness selected — pick one on the Controls page.</div>'; return; }
  if (_hcRendered === h.id) { if (h.kind === 'builtin') _hcLoadSessions(true); return; }
  _hcRendered = h.id;

  shell.innerHTML = h.kind === 'builtin' ? _hcBuiltinHtml(h) : _hcExternalHtml(h);
  if (h.kind === 'builtin') { _hcLoadSessions(); _hcLoadMemory(); _hcLoadProposals(); _hcLoadAgents(); _hcStatus(); _hcLoadApproval(); }
  else requestAnimationFrame(() => _harnessTermOpen(h));
}
