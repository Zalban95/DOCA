/* ═══════════════════════════════════════════════════════
   Settings → General → Updates, in a production hive (modules/update-channel): what the update channel found, when it
   installs (off, notify, or inside a window on the hive's own clock), Update now, and what an update waits on — it never
   cuts running work. A development hive keeps its git updates (updates.js) and never draws this.
   ═══════════════════════════════════════════════════════ */

const _UC_DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

/** Drawn by updateCheck() when /api/update-check answers from the channel. */
async function updateChannelDraw(check, { el, badge, pullBtn } = {}) {
  if (pullBtn) pullBtn.style.display = 'none';   // git: a development hive's
  let s;
  try { s = await apiFetch('/api/update/channel'); } catch (e) { if (el) el.innerHTML = `<div class="update-info" style="color:var(--red)">✗ ${escHtml(e.message)}</div>`; return; }
  if (badge) { badge.style.display = s.latest ? 'inline-block' : 'none'; badge.title = s.latest ? `Update: ${s.latest.version} ready` : ''; }
  const day = t => (t ? String(t).slice(0, 16).replace('T', ' ') : '—');
  const line = [];
  if (!s.channel.ok) line.push(`<span style="color:var(--amber)">${escHtml(s.channel.why)}</span>`);
  else if (s.lastError) line.push(`<span style="color:var(--amber)">? Could not check: ${escHtml(s.lastError)}</span>`);
  else if (s.latest) line.push(`<strong style="color:var(--amber)">${escHtml(s.latest.version)} is ready</strong> — running ${escHtml(s.running)}`);
  else line.push(`<span style="color:var(--green)">✓ Up to date — ${escHtml(s.running)}</span>`);
  if (s.urgent) line.push(`<span style="color:var(--red)">Urgent: applied at the first quiet moment after ${escHtml(day(s.urgent.applyBy))}.</span>`);
  if (s.waiting) line.push(`Waiting for running work before switching: ${escHtml(s.waiting.on.join('; ') || 'nothing now')}.`);
  if (s.failed) line.push(`<span style="color:var(--red)">${escHtml(s.failed.version)} did not start, and the hive went back by itself. It is tried again only when asked.</span>`);
  if (s.stageError) line.push(`<span style="color:var(--red)">Could not prepare it: ${escHtml(s.stageError)}</span>`);
  if (s.latest?.notes) line.push(`<details><summary>What it changes</summary><div style="white-space:pre-wrap;font-size:12px">${escHtml(s.latest.notes)}</div></details>`);
  line.push(`<span style="opacity:.6;font-size:11px">checked ${escHtml(day(s.lastCheck))} with the update channel${s.staged ? ` · ${escHtml(s.staged)} staged` : ''}</span>`);
  const set = s.settings;
  const days = _UC_DAYS.map(([d, l]) => `<label style="display:inline-flex;gap:3px;align-items:center;font-size:12px"><input type="checkbox" class="uc-day" value="${d}"${set.days.includes(d) ? ' checked' : ''}>${l}</label>`).join(' ');
  const image = s.image ? '<p class="desc">This hive runs an image: its host installs updates (deploy/hive.sh update), and the hive holds its work for that.</p>' : '';
  if (el) el.innerHTML = `<div class="update-info">${line.join('<br>')}</div>${image}
    <div class="form-row" style="margin-top:10px"><label>Install updates</label>
      <select id="uc-auto" class="input" style="width:auto">
        <option value="off"${set.auto === 'off' ? ' selected' : ''}>Only when I ask</option>
        <option value="notify"${set.auto === 'notify' ? ' selected' : ''}>Tell me, I install</option>
        <option value="window"${set.auto === 'window' ? ' selected' : ''}>In a window</option>
      </select></div>
    <div id="uc-window" style="${set.auto === 'window' ? '' : 'display:none'}">
      <div class="form-row"><label>Days</label><span style="display:flex;gap:8px;flex-wrap:wrap">${days}</span></div>
      <div class="form-row"><label>From</label><input id="uc-from" class="input" type="time" value="${escHtml(set.from)}" style="width:auto">
        <label style="min-width:0">to</label><input id="uc-to" class="input" type="time" value="${escHtml(set.to)}" style="width:auto"></div>
    </div>
    <p class="desc">Running conversations, calls and devices' commands are never cut: an update waits for them, now or in the window. If the new version does not answer within 90 s, the hive goes back by itself.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="updateChannelSave()">Save</button>
      <button class="btn btn-sm" onclick="updateChannelDo('check')">Check now</button>
      ${s.latest && !s.image ? `<button class="btn btn-sm" onclick="updateChannelDo('apply')">Update now</button>` : ''}
      ${s.waiting || s.requested ? `<button class="btn btn-sm" onclick="updateChannelDo('cancel')">Call it off</button>` : ''}
    </div>
    <span class="status-line" id="uc-status"></span>`;
  document.getElementById('uc-auto')?.addEventListener('change', e => { const w = document.getElementById('uc-window'); if (w) w.style.display = e.target.value === 'window' ? '' : 'none'; });
}

async function updateChannelSave() {
  const body = { auto: document.getElementById('uc-auto').value, days: [...document.querySelectorAll('.uc-day:checked')].map(x => x.value),
    from: document.getElementById('uc-from')?.value, to: document.getElementById('uc-to')?.value };
  try { await apiFetch('/api/update/channel', { method: 'POST', body }); setStatus(document.getElementById('uc-status'), '✓ Saved', 'ok'); }
  catch (e) { setStatus(document.getElementById('uc-status'), `✗ ${e.message}`, 'err'); }
}

async function updateChannelDo(what) {
  const st = document.getElementById('uc-status');
  setStatus(st, what === 'apply' ? 'Preparing the update…' : what === 'check' ? 'Checking…' : 'Calling it off…', '', { clear: 0 });
  try {
    const url = { check: '/api/update/channel/check', apply: '/api/update/channel/apply', cancel: '/api/update/channel/cancel' }[what];
    await apiFetch(url, { method: 'POST' });
    await updateCheck();
  } catch (e) { setStatus(document.getElementById('uc-status'), `✗ ${e.message}`, 'err'); }
}
