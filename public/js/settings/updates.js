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
  versionsLoad();
  accountLoad();
  depsLoad();

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
      // Running a release, the server updated by switching to the newest one
      // and is restarting into it: follow it back instead of asking for a restart.
      if (obj.ok && obj.restarting) {
        if (el) el.innerHTML = '<div class="update-info">Restarting into the new version…</div>';
        const started = Date.now();
        const poll = () => setTimeout(async () => {
          try { if ((await fetch('/api/update-check', { cache: 'no-store' })).ok && Date.now() - started > 4000) return location.reload(); } catch {}
          if (Date.now() - started < 150000) poll();
          else if (el) el.innerHTML = '<div class="update-info" style="color:var(--red)">✗ The panel did not come back within 150 s. On the host: ./run.sh versions</div>';
        }, 2000);
        return poll();
      }
      if (obj.ok && el && /Restart DOCA to apply/.test(log?.textContent || '')) {
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
  settingsAskIfBusy('Restarting', whenIdle => {
    if (whenIdle === null) return appConfirm('Restart the DOCA server? The page will reload once it comes back.', () => _restartGo(false));
    _restartGo(whenIdle);
  }, 'Restart now');
}

async function _restartGo(whenIdle) {
  const btn = document.getElementById('restart-btn');
  const el  = document.getElementById('update-status');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Restarting…'; }

  // The process exits ~500ms after replying, so a dropped response is normal.
  let info = {};
  try {
    const r = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whenIdle }) });
    info = await r.json().catch(() => ({}));
  } catch {}

  if (info.ok === false) {
    if (el) el.innerHTML = `<div class="update-info" style="color:var(--red)">✗ ${escHtml(info.error || 'Restart failed.')}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Restart'; }
    return;
  }

  let started = Date.now();

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
  if (info.waiting) {
    if (btn) btn.textContent = '⟳ Waiting…';
    return settingsWaitForIdle(el, () => { started = Date.now(); poll(); });
  }
  poll();
}

/* ── The version in use: roll back, or forward ───────── */

let _versions = null;

const _versionDay = iso => (iso ? fmtDate(iso) : '');

/** One option's text: which version, when it was released, when it came to this machine, and what to know first. */
function _versionLabel(v) {
  if (v.tag === 'checkout') return `Working copy (${(v.head || '').split(' ')[0] || 'git checkout'})${v.running ? ' · running' : ''}`;
  return [
    v.tag,
    `released ${_versionDay(v.releasedAt)}`,
    v.installedAt ? `installed here ${_versionDay(v.installedAt)}` : '',
    v.running ? 'running' : '',
    !v.compatible ? 'too old: would not find your data' : '',
    v.compatible && v.olderData ? 'older data format' : '',
    v.compatible && !v.hasMenu ? 'no version menu' : '',
  ].filter(Boolean).join(' · ');
}

/** Draw the version dropdown under the update card. */
async function versionsLoad() {
  const log = document.getElementById('update-log');
  if (!log) return;
  let box = document.getElementById('versions-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'versions-box';
    box.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:6px';
    log.after(box);
  }
  box.innerHTML = '<span class="placeholder pulse" style="font-size:12px">Reading versions…</span>';
  try {
    _versions = await apiFetch('/api/versions');
  } catch (e) {
    box.innerHTML = `<span class="status-line err">✗ ${escHtml(e.message)}</span>`;
    return;
  }
  const opts = _versions.versions.map(v =>
    `<option value="${escHtml(v.tag)}"${v.current ? ' selected' : ''}${v.compatible ? '' : ' disabled'}>${escHtml(_versionLabel(v))}</option>`).join('');
  box.innerHTML = `
    <div class="field" style="margin-bottom:0">
      <label class="input-label" for="versions-select" style="display:block">Version</label>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="input flex1" id="versions-select" style="min-width:0">${opts}</select>
        <button class="btn btn-xs btn-teal" id="versions-use-btn" onclick="versionsUse()" title="Switch to the selected version">Switch</button>
      </div>
    </div>
    <span class="status-line" id="versions-status"></span>
    <p style="font-size:11px;color:var(--muted);margin:0">
      Every version reads the same data. A version that does not answer within 90 s after a switch is
      switched back on its own. If the dashboard will not load at all: <code>./run.sh use &lt;version&gt;</code> on the host.
    </p>`;
  const st = document.getElementById('versions-status');
  if (!_versions.versions.length) {
    document.getElementById('versions-use-btn').disabled = true;
    setStatus(st, _versions.warning || 'No versions to switch to.', 'warn', { clear: 0 });
  } else if (!_versions.launcher) {
    document.getElementById('versions-use-btn').disabled = true;
    setStatus(st, 'Started without run.sh — switching versions needs the launcher (./run.sh or the boot service).', 'warn', { clear: 0 });
  } else if (_versions.warning) {
    setStatus(st, _versions.warning, 'warn', { clear: 0 });
  }
}

/** Switch to the version in the dropdown, then wait for the panel to come back on it. */
function versionsUse() {
  const tag = document.getElementById('versions-select')?.value;
  const v = _versions?.versions.find(x => x.tag === tag);
  if (!v || v.current) return;
  const lines = [`Switch DOCA from ${_versions.current} to ${tag}? The panel restarts.`,
    `If ${tag} does not answer within 90 seconds, it switches back to ${_versions.current} on its own.`];
  if (!v.hasMenu) lines.push(`${tag} predates this menu. To leave it, run ./run.sh use <version> on the host.`);
  if (v.olderData) lines.push(`${tag} writes an older data format than yours. Running it risks the data — make a backup first.`);
  const go = async whenIdle => {
    const log = document.getElementById('update-log');
    const st  = document.getElementById('versions-status');
    const btn = document.getElementById('versions-use-btn');
    if (btn) btn.disabled = true;
    showStream(log, '');
    let result = null;
    await sseStream('/api/versions/use', { version: tag, force: !!v.olderData, whenIdle }, {
      onStatus: text => appendStream(log, text),
      onDone:   o => { result = o; },
      onError:  e => appendStream(log, `\n✗ ${e.message}\n`),
    });
    if (!result?.ok) {
      if (btn) btn.disabled = false;
      return setStatus(st, '✗ The switch did not happen — see the log above.', 'err');
    }
    if (!result.restarting && !result.waiting) return versionsLoad();
    // Asked of /api/update-check, which every version has — an older one has no
    // /api/versions to ask. Its `current` is the version that process booted as.
    const before = _versions.version, want = tag === 'checkout' ? null : tag.replace(/^v/, '');
    let started = Date.now();
    const poll = () => setTimeout(async () => {
      try {
        const r = await fetch('/api/update-check', { cache: 'no-store' });
        if (r.ok) {
          const now = (await r.json()).current;
          if (want ? now === want : (now !== before || Date.now() - started > 8000)) return location.reload();
          if (want && now === before && want !== before && Date.now() - started > 20000)
            return setStatus(st, `✗ ${tag} did not come up, and the launcher switched back to ${result.from}. See .releases/log.jsonl on the host.`, 'err', { clear: 0 });
        }
      } catch {}
      if (Date.now() - started > 150000)
        return setStatus(st, '✗ The panel did not come back within 150 s. On the host: ./run.sh versions', 'err', { clear: 0 });
      setStatus(st, `Restarting into ${tag}… ${Math.round((Date.now() - started) / 1000)}s`, '', { clear: 0 });
      poll();
    }, 2000);
    if (result.waiting) return settingsWaitForIdle(st, () => { started = Date.now(); poll(); });
    poll();
  };
  settingsAskIfBusy(`Switching to ${tag}`, whenIdle => {
    if (whenIdle === null) return appConfirm(lines.join('\n\n'), () => go(false));
    if (v.olderData) return appConfirm(lines.join('\n\n'), () => go(whenIdle));
    go(whenIdle);
  }, 'Switch now');
}

