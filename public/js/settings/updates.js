/* ═══════════════════════════════════════════════════════
   Settings → General: updates, the version in use, restart, and start at boot.
   ═══════════════════════════════════════════════════════ */

/* ── Update Checker ──────────────────────────────────── */

async function updateCheck() {
  const el      = document.getElementById('update-status');
  const badge   = document.getElementById('update-badge');
  const btn     = document.getElementById('update-check-btn');
  const pullBtn = document.getElementById('update-pull-btn');
  if (btn) btn.disabled = true;
  if (el) el.innerHTML = '<span class="placeholder pulse" style="font-size:12px">Checking for updates…</span>';

  try {
    const data = await apiFetch('/api/update-check?force=1');
    if (data.updateAvailable) {
      if (el) el.innerHTML = `<div class="update-info">
        <strong style="color:var(--amber)">Update available!</strong><br>
        Current: <code>${escHtml(data.current)}</code> → Latest: <code>${escHtml(data.latest)}</code><br>
        <a href="${escHtml(data.repo)}/releases" target="_blank" rel="noopener">View release notes ↗</a>
      </div>`;
      if (badge) { badge.style.display = 'inline-block'; badge.title = `Update: v${data.latest} available`; }
      if (pullBtn) pullBtn.style.display = '';
    } else if (data.checked === false) {
      // Not an error and not an all-clear: the check did not happen. Saying
      // "up to date" here is the panel asserting something it does not know.
      if (el) el.innerHTML = `<div class="update-info" style="color:var(--amber)">
        ? Could not check — running <code>${escHtml(data.current)}</code><br>
        <span style="opacity:.8">${escHtml(data.reason || '')}</span>
      </div>`;
      if (badge) badge.style.display = 'none';
      if (pullBtn) pullBtn.style.display = '';
    } else {
      // Say how it knows. "Up to date" from a source that cannot see private
      // tags is the claim that started all this.
      if (el) el.innerHTML = `<div class="update-info" style="color:var(--green)">
        ✓ Up to date — <code>${escHtml(data.current)}</code>${data.source
          ? `<br><span style="opacity:.6;font-size:11px">checked with ${escHtml(data.source)}</span>` : ''}
      </div>`;
      if (badge) badge.style.display = 'none';
      if (pullBtn) pullBtn.style.display = 'none';
    }
  } catch (e) {
    if (el) el.innerHTML = `<div class="update-info" style="color:var(--red)">
      ✗ Could not check: ${escHtml(e.message)}
    </div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updatePull() {
  const btn  = document.getElementById('update-pull-btn');
  const log  = document.getElementById('update-log');
  const el   = document.getElementById('update-status');
  // An update can run `npm install`; restarting through that leaves a
  // half-installed tree, so hold the button until the stream is done.
  const rbtn = document.getElementById('restart-btn');
  const rTitle = rbtn?.title;
  if (btn) btn.disabled = true;
  if (rbtn) { rbtn.disabled = true; rbtn.title = 'Wait for the update to finish before restarting'; }
  if (log) { log.style.display = 'block'; log.textContent = ''; }

  const releaseRestart = () => {
    if (rbtn) { rbtn.disabled = false; if (rTitle) rbtn.title = rTitle; }
  };

  await sseStream('/api/update', {}, {
    onStatus: text => appendStream(log, text),
    onDone: obj => {
      if (obj.ok && el) {
        // "restart DOCA" — the update pulled *this* tree, so it is this process
        // that has to come back. The external OpenClaw stack says "restart
        // OpenClaw" (keys.js) and is a different restart entirely.
        el.innerHTML = `<div class="update-info" style="color:var(--green)">
          ✓ Update pulled successfully. <strong>Restart DOCA</strong> to apply.
        </div>`;
      }
      if (btn) btn.disabled = false;
      releaseRestart();
    },
    onError: e => {
      if (log) log.textContent += `\nError: ${e.message}`;
      if (btn) btn.disabled = false;
      releaseRestart();
    },
  });
}

/* ── Start at Boot ───────────────────────────────────── */

async function startupLoad() {
  const box = document.getElementById('startup-toggle');
  const st  = document.getElementById('startup-status');
  try {
    const s = await apiFetch('/api/startup');
    if (box) { box.checked = !!s.enabled; box.disabled = !s.supported; }
    // These three describe the machine as it stands rather than something that
    // just happened, so they are `clear: 0` — the card would otherwise lose the
    // reason its own toggle is greyed out three seconds after drawing it.
    if (!s.supported) return setStatus(st, s.reason, 'warn', { clear: 0 });

    if (!s.enabled) return setStatus(st, 'DOCA will not come back on its own after a reboot.', '', { clear: 0 });
    setStatus(st, s.active
      ? `✓ Enabled — ${s.service} is running${s.supervised ? ' and owns this panel' : ''}`
      : `✓ Enabled — ${s.service} starts at the next boot`, 'ok', { clear: 0 });
  } catch (e) {
    if (box) box.disabled = true;
    setStatus(st, `✗ ${e.message}`, 'err');
  }
}

function startupToggle(box) {
  const want = box.checked;
  box.checked = !want;   // stay on the real state until the service confirms it
  sudoAsk(
    `${want ? 'Installing' : 'Removing'} the boot service requires elevated privileges.`,
    pw => { if (pw !== null) _startupApply(want, pw); },
  );
}

async function _startupApply(enabled, password) {
  const box = document.getElementById('startup-toggle');
  const log = document.getElementById('startup-log');
  if (box) box.disabled = true;
  showStream(log);

  const finish = () => { if (box) box.disabled = false; startupLoad(); };
  await sseStream('/api/startup', { enabled, password }, {
    onStatus: text => appendStream(log, text),
    onDone:   finish,
    onError:  e => { appendStream(log, `\nError: ${e.message}`); finish(); },
  });
}

const RESTART_TIMEOUT_MS = 90000;

function restartDoca() {
  appConfirm('Restart the DOCA server? The page will reload once it comes back.', async () => {
    const btn = document.getElementById('restart-btn');
    const el  = document.getElementById('update-status');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Restarting…'; }

    // The process exits ~500ms after replying, so a dropped response is normal.
    let info = {};
    try {
      const r = await fetch('/api/restart', { method: 'POST' });
      info = await r.json().catch(() => ({}));
    } catch {}

    if (info.ok === false) {
      if (el) el.innerHTML = `<div class="update-info" style="color:var(--red)">✗ ${escHtml(info.error || 'Restart failed.')}</div>`;
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Restart'; }
      return;
    }

    const started = Date.now();

    // Never spin forever: if nothing is listening again, say where to look.
    const giveUp = () => {
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Restart'; }
      if (!el) return;
      const where = info.selfRespawn
        ? `A successor process was started${info.handoff?.pid ? ` (pid ${info.handoff.pid})` : ''} but never began serving — check <code>${escHtml(info.handoff?.log || '.doca/restart.log')}</code> on the host.`
        : `DOCA is supervised by <code>${escHtml(info.supervisor || 'an external supervisor')}</code>, so check it there — e.g. <code>systemctl status openclaw-panel</code>.`;
      el.innerHTML = `<div class="update-info" style="color:var(--red)">
        ✗ The server did not come back within ${Math.round(RESTART_TIMEOUT_MS / 1000)}s.<br>${where}
      </div>`;
    };

    const poll = () => {
      setTimeout(async () => {
        try {
          const r = await fetch('/api/status', { cache: 'no-store' });
          if (!r.ok) throw new Error(String(r.status));
          location.reload();
          return;
        } catch {}
        if (Date.now() - started >= RESTART_TIMEOUT_MS) return giveUp();
        if (btn) btn.textContent = `⟳ Restarting… ${Math.round((Date.now() - started) / 1000)}s`;
        poll();
      }, 1500);
    };
    poll();
  });
}

