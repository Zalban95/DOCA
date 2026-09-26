/* ═══════════════════════════════════════════════════════
   Settings → Backups → On a schedule (modules/backup/schedule.js):
   off, daily or weekly at a time, keeping the last N automatic backups.
   Built from the same pieces as the Backups card above it.
   ═══════════════════════════════════════════════════════ */

function _backupScheduleCard() {
  let card = document.getElementById('backup-schedule-card');
  if (card) return card;
  const panel = document.getElementById('sp-backups');
  if (!panel) return null;
  card = document.createElement('div');
  card.className = 'card';
  card.id = 'backup-schedule-card';
  card.innerHTML = `
    <div class="card-title">On a schedule</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:12px">
      Scheduled backups are named <code>auto-…</code>, and only those are removed to keep the last few —
      backups made by hand, uploaded, or made before a restore are never touched.
    </p>
    <div class="row" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="field"><div class="input-label">How often</div>
        <select class="input" id="bsched-every" style="width:auto">
          <option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
        </select></div>
      <div class="field"><div class="input-label">At</div>
        <input class="input" type="time" id="bsched-at" style="width:auto"></div>
      <div class="field"><div class="input-label">Keep the last</div>
        <input class="input" type="number" id="bsched-keep" min="1" max="365" step="1" style="width:90px"></div>
      <div class="field"><button class="btn btn-sm btn-blue" onclick="backupScheduleSave()">Save</button></div>
    </div>
    <div class="input-label" id="bsched-info" style="text-transform:none;letter-spacing:0;margin-top:4px"></div>
    <span class="status-line" id="bsched-status"></span>`;
  panel.appendChild(card);
  return card;
}

/** Drawn by backupsLoad() with what /api/backups returned. */
function backupScheduleRender(sch, settings) {
  if (!sch || !_backupScheduleCard()) return;
  document.getElementById('bsched-every').value = sch.every;
  document.getElementById('bsched-at').value = sch.at;
  document.getElementById('bsched-keep').value = sch.keep;
  const info = document.getElementById('bsched-info');
  const parts = [];
  if (sch.every !== 'off' && sch.nextAt) parts.push(`Next: ${fmtDate(sch.nextAt)}.`);
  if (sch.lastAt) parts.push(`Last: ${fmtDate(sch.lastAt)} (${sch.lastName}).`);
  const noPassword = sch.every !== 'off' && settings?.encrypt && !settings.hasSavedPassword;
  if (noPassword) parts.push('Backups are password-protected and none is saved, so scheduled ones cannot be made — save one above.');
  info.textContent = parts.join(' ');
  info.style.color = noPassword ? 'var(--amber)' : '';
  if (sch.lastError && (!sch.lastAt || sch.lastTriedAt > sch.lastAt)) {
    info.textContent += ` The last attempt (${fmtDate(sch.lastTriedAt)}) failed: ${sch.lastError}`;
    info.style.color = 'var(--red)';
  }
}

async function backupScheduleSave() {
  const st = document.getElementById('bsched-status');
  const body = {
    every: document.getElementById('bsched-every').value,
    at:    document.getElementById('bsched-at').value,
    keep:  parseInt(document.getElementById('bsched-keep').value, 10),
  };
  try {
    const sch = await apiFetch('/api/backups/schedule', { method: 'POST', body });
    backupScheduleRender(sch, _backups?.settings);
    setStatus(st, sch.every === 'off' ? '✓ Scheduled backups are off' : `✓ ${sch.every === 'daily' ? 'Daily' : 'Weekly'} at ${sch.at}, keeping ${sch.keep}`, 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}
