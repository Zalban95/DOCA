/* ═══════════════════════════════════════════════════════
   Restarting without cutting work off (modules/harness/drain.js), from the
   page: before a restart or a version switch, say what is running and offer to
   wait for it; while waiting, show what it waits on and a way to call it off.
   ═══════════════════════════════════════════════════════ */

/**
 * Ask before `what` ("Restarting", "Switching to v2.60.0") when turns are running.
 * cb(null): nothing is running, confirm the usual way; cb(true): wait for them;
 * cb(false): go now. Cancel calls nothing.
 */
async function settingsAskIfBusy(what, cb, nowLabel = 'Go ahead now') {
  let turns = [];
  try { turns = (await apiFetch('/api/harness/busy')).turns || []; } catch { /* ask the usual way */ }
  if (!turns.length) return cb(null);
  const names = turns.slice(0, 6).map(t => `• ${t.title}${t.auto ? ' (working on its own)' : ''}`).join('\n');
  const more = turns.length > 6 ? `\n…and ${turns.length - 6} more` : '';
  appChoose(`${turns.length === 1 ? 'A conversation is' : `${turns.length} conversations are`} working right now:\n${names}${more}\n\n`
    + `${what} now stops ${turns.length === 1 ? 'it' : 'them'} mid-step. They carry on afterwards, but a step cut in half `
    + 'is not a finished one. Waiting holds the restart until they are done (at most 30 minutes) and starts no new automatic work meanwhile.',
  [{ label: 'Cancel', value: undefined }, { label: nowLabel, value: false, cls: 'btn-red' },
   { label: 'When they finish', value: true, cls: 'btn-teal' }],
  v => { if (v !== undefined) cb(v); });
}

/** Show what a waiting restart waits on, until it happens; then onGone(). */
function settingsWaitForIdle(el, onGone) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    let r;
    try { r = await apiFetch('/api/harness/busy'); } catch { return onGone(); }   // it is restarting
    if (!r.pending) return onGone();
    if (el) {
      el.innerHTML = '';
      const line = document.createElement('div');
      line.className = 'update-info';
      line.textContent = `Waiting for ${r.pending.waitingOn.length} running turn(s) before the ${r.pending.label}: `
        + `${r.pending.waitingOn.map(t => t.title).join(', ') || 'finishing'}. `;
      const btn = document.createElement('button');
      btn.className = 'btn btn-xs';
      btn.textContent = 'Stop waiting';
      btn.onclick = async () => {
        stopped = true;
        await apiFetch('/api/restart', { method: 'POST', body: { cancel: true } }).catch(() => {});
        line.textContent = 'Not restarting. The version chosen, if any, starts at the next restart.';
      };
      line.appendChild(btn);
      el.appendChild(line);
    }
    setTimeout(tick, 3000);
  };
  tick();
}
