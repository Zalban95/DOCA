/* Settings → Harness → Finished missions (modules/agents/tidy.js): whether finished specialists' missions are put away
   in the Archive by themselves, and — under Advanced — after how long. The common case is one switch; the two numbers
   are `missions.archiveSeenAfterMin` and `missions.archiveAfterHours` (0 turns a rule off). Housekeeping, not a guard,
   so the agent may propose them too. A host's card: the settings are the hive's. */
async function missionsTidyCardRender(panel) {
  if (typeof authHasRight === 'function' && !authHasRight('host')) return;
  let s;
  try { ({ settings: s } = await apiFetch('/api/harness/missions/tidy')); } catch { return; }
  document.getElementById('missions-tidy-card')?.remove();
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'missions-tidy-card' });
  const on = s.archiveSeenAfterMin > 0 || s.archiveAfterHours > 0;
  const num = (key, unit, def, hint) => `<label style="display:inline-flex;gap:6px;align-items:center;font-size:12px;margin:2px 12px 2px 0" title="${escHtml(hint)}">
      <input class="input" type="number" min="0" data-missions-tidy="${key}" data-default="${def}" value="${Number(s[key]) || 0}" style="width:80px">
      <span style="color:var(--muted)">${unit}</span></label>`;
  card.innerHTML = `<div class="card-title">Finished missions</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">A specialist's finished mission goes to the Archive by itself once nobody needs it:
      a while after you opened it, or a day after it finished. One its leader has not read, one waiting for you, or one you kept with 📌 stays.
      Agents → Archive brings any of them back.</p>
    <label style="display:flex;gap:8px;align-items:center;font-size:12px"><input type="checkbox" id="missions-tidy-on" ${on ? 'checked' : ''}
      onchange="missionsTidySave(this.checked ? 'on' : 'off')"> Put finished missions away by themselves</label>
    ${advancedFold(`${num('archiveSeenAfterMin', 'minutes after you opened it', 30, 'missions.archiveSeenAfterMin — 0: never by this rule')}
      ${num('archiveAfterHours', 'hours after it finished, seen or not', 24, 'missions.archiveAfterHours — 0: never by this rule')}
      <div class="toolbar" style="margin-top:6px"><button class="btn btn-sm btn-blue" onclick="missionsTidySave()">Save</button></div>`, { id: 'missions-tidy', label: 'Advanced' })}
    <span class="status-line" id="missions-tidy-status"></span>`;
  panel.append(card);
}

/** 'on' puts the defaults back, 'off' sets both to 0; nothing saves the two boxes as typed. */
async function missionsTidySave(how) {
  const card = document.getElementById('missions-tidy-card');
  if (!card) return;
  const boxes = [...card.querySelectorAll('[data-missions-tidy]')];
  const missions = {};
  for (const b of boxes) missions[b.dataset.missionsTidy] = how === 'off' ? 0 : how === 'on' ? Number(b.dataset.default) : Math.max(0, Number(b.value) || 0);
  try { await apiFetch('/api/prefs', { method: 'POST', body: { missions } }); } catch (e) { return appAlert(e.message); }
  for (const b of boxes) b.value = missions[b.dataset.missionsTidy];
  const on = document.getElementById('missions-tidy-on');
  if (on) on.checked = missions.archiveSeenAfterMin > 0 || missions.archiveAfterHours > 0;
  setStatus(document.getElementById('missions-tidy-status'), '✓ Saved', 'ok');
}
