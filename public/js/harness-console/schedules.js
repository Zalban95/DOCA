/* ═══════════════════════════════════════════════════════
   Harness → Schedules (modules/schedules; TODO H7.1): a message sent to a
   conversation, or a recipe run, on a timetable — as you, with your level and
   approvals. One the agent proposed waits here until you switch it on.
   ═══════════════════════════════════════════════════════ */

async function hcSchedulesLoad() {
  const box = document.getElementById('hc-schedules');
  if (!box) return;
  let list = [];
  try { list = (await apiFetch('/api/schedules')).schedules || []; }
  catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  box.innerHTML = list.map(s => {
    const reminder = s.kind === 'reminder';   // once, then done (schedules/index.js)
    const mark = reminder ? '⏰' : s.state === 'on' ? '●' : s.state === 'proposed' ? '◌' : '○';
    const last = s.last ? ` · last ${s.last.ok ? 'ok' : 'failed'}` : '';
    if (reminder) return `<div class="hc-agent ${s.state === 'on' ? '' : 'off'}" title="${escHtml(s.text || '')}${s.last ? `\n\n${escHtml(s.last.summary)}` : ''}">
      <span class="hc-agent-id">${mark} ${escHtml(s.title)}</span>
      <span class="hc-agent-note">reminder · ${escHtml(s.whenText)}${s.state === 'done' ? ' · done' : ''}${last}</span>
      <button class="btn btn-xs btn-red" onclick="hcScheduleDelete(${jsArg(s.id)})" title="Delete">✕</button></div>`;
    return `<div class="hc-agent ${s.state === 'on' ? '' : 'off'}" title="${escHtml(s.kind === 'turn' ? s.message : `recipe ${s.recipe}`)}${s.last ? `\n\nLast: ${escHtml(s.last.summary)}` : ''}">
      <span class="hc-agent-id">${mark} ${escHtml(s.title)}</span>
      <span class="hc-agent-note">${escHtml(s.whenText)}${s.state === 'proposed' ? ' · proposed by the agent' : ''}${last}</span>
      ${s.state === 'on' ? `<button class="btn btn-xs" onclick="hcScheduleState(${jsArg(s.id)}, 'paused')" title="Pause">⏸</button>`
        : `<button class="btn btn-xs ${s.state === 'proposed' ? 'btn-blue' : ''}" onclick="hcScheduleState(${jsArg(s.id)}, 'on')" title="${s.state === 'proposed' ? 'Switch it on: it runs as you' : 'Resume'}">▶</button>`}
      <button class="btn btn-xs" onclick="hcScheduleRun(${jsArg(s.id)})" title="Run it now">↻</button>
      ${s.last?.sessionId ? `<button class="btn btn-xs" onclick="hcOpenSession(${jsArg(s.last.sessionId)})" title="Open what it did">↗</button>` : ''}
      <button class="btn btn-xs btn-red" onclick="hcScheduleDelete(${jsArg(s.id)})" title="Delete">✕</button>
    </div>`;
  }).join('') || '<div class="placeholder">None — ＋ sends a message on a timetable; ⏰ on a recipe runs it on one.</div>';
}

/** A turn (no recipe given) or a recipe on a timetable: what, then when. */
function hcScheduleNew(recipeId) {
  const when = body => appChoose('When?', [
    { label: 'Every hour', value: { every: 60 } }, { label: 'Daily 09:00', value: { cron: '0 9 * * *' } },
    { label: 'Weekdays 09:00', value: { cron: '0 9 * * 1-5' } }, { label: 'Custom…', value: 'custom' }], async w => {
    const go = async timing => {
      try { await apiFetch('/api/schedules', { method: 'POST', body: { ...body, ...timing } }); } catch (e) { appAlert(e.message); }
      hcSchedulesLoad();
    };
    if (w !== 'custom') return go(w);
    appPrompt('Every how many minutes — or a cron expression (minute hour day month weekday, host time):', v => go(/^\d+$/.test(v.trim()) ? { every: Number(v) } : { cron: v.trim() }), '0 9 * * 1');
  });
  if (recipeId) return when({ kind: 'recipe', recipe: recipeId, title: `Recipe ${recipeId}` });
  appPrompt('What should be sent each time? (as an instruction — it starts a turn in a conversation of its own)', message => {
    if (message.trim()) when({ kind: 'turn', message, title: message.slice(0, 60) });
  });
}

async function hcScheduleState(id, state) {
  try { await apiFetch(`/api/schedules/${encodeURIComponent(id)}/state`, { method: 'POST', body: { state } }); } catch (e) { appAlert(e.message); }
  hcSchedulesLoad();
}

async function hcScheduleRun(id) {
  try { const s = await apiFetch(`/api/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' }); appAlert(`${s.last?.ok ? 'Done' : 'Failed'}: ${s.last?.summary || ''}`); }
  catch (e) { appAlert(e.message); }
  hcSchedulesLoad();
}

function hcScheduleDelete(id) {
  appConfirm('Delete this schedule?', async () => {
    try { await apiFetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    hcSchedulesLoad();
  });
}

// A schedule made or changed anywhere — the agent's `remind` or `schedule`, another screen — redraws the list.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  if (typeof liveOn === 'function') liveOn('schedules', liveDebounce(() => { if (document.getElementById('hc-schedules')) hcSchedulesLoad(); }, 300));
});
