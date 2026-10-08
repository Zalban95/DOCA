/* Settings → Harness → Thinking (modules/harness/turn/thinking.js; asked 2026-10-08): whether each kind of conversation
   thinks before it answers — auto (as before: the triage, assistant mode's effort, the harness's), off, or on at a level.
   One row per mode, the calls included: thinking is the agent's behaviour, the same switch in every mode, so it sits
   with DOCA's own agent rather than under Voice (whose cards are how a screen listens and speaks). Under Advanced: who
   wins within a mode, and how each provider with a key hears it. A preference, so the agent may propose it too. */
async function thinkingCardRender(panel) {
  if (typeof authHasRight === 'function' && !authHasRight('host')) return;
  let t;
  try { t = await apiFetch('/api/harness/thinking'); } catch { return; }
  document.getElementById('thinking-card')?.remove();
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'thinking-card' });
  const said = { auto: 'Auto', off: 'Off', low: 'On — low', medium: 'On — medium', high: 'On — high' };
  const row = m => `<div class="thinking-row">
      <label for="thinking-${m.id}">${escHtml(m.label)}</label>
      <select class="input" id="thinking-${m.id}" data-thinking="${m.id}" onchange="thinkingSave()">
        ${t.choices.map(c => `<option value="${c}" ${c === m.value ? 'selected' : ''}>${said[c] || c}</option>`).join('')}</select>
      <span class="thinking-hint">${escHtml(m.hint)}</span></div>`;
  const typed = t.modes.filter(m => !['liveCall', 'deepCall', 'ambient', 'device'].includes(m.id));
  const spoken = t.modes.filter(m => ['liveCall', 'deepCall', 'ambient', 'device'].includes(m.id));
  const providers = t.providers.length ? `<table class="data-table" style="width:100%;font-size:11px;margin-top:6px">
      <thead><tr><th style="text-align:left;width:22%">Provider</th><th style="text-align:left">How it hears it</th><th style="text-align:left;width:24%">Known by</th></tr></thead><tbody>
      ${t.providers.map(p => `<tr><td>${escHtml(p.label)}</td><td>${escHtml(p.says || p.dialect)}</td><td>${escHtml(p.source)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="thinking-hint">No provider with a key yet.</p>';
  card.innerHTML = `<div class="card-title">Thinking</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Whether the agent thinks before it answers, by the kind of conversation.
      Off answers sooner and costs less; on is for work that needs care. Auto keeps what each mode did before.</p>
    <div class="thinking-group">Typed</div>${typed.map(row).join('')}
    <div class="thinking-group">Spoken</div>${spoken.map(row).join('')}
    <span class="status-line" id="thinking-status"></span>
    ${advancedFold(`<p class="thinking-hint" style="margin:0 0 6px">Within a mode the nearer word wins: a message that asks to think harder
        thinks hard for that message; the 💭 beside Send (or in a call) sets it for that conversation or call; the agent changes a
        conversation's when asked (its <code>effort</code> tool); then the setting above. Each turn's choice and why are in its trace
        (⏱) and in Chronicle.</p>
      <p class="thinking-hint" style="margin:0">A provider that refuses the way it was asked is asked once more another way, and
        remembered — Harness ⚙ → "What providers accept" forgets a lesson.</p>${providers}`, { id: 'thinking-advanced', label: 'Advanced', count: t.providers.length })}`;
  panel.append(card);
}

async function thinkingSave() {
  const thinking = {};
  for (const s of document.querySelectorAll('#thinking-card [data-thinking]')) thinking[s.dataset.thinking] = s.value;
  try { await apiFetch('/api/prefs', { method: 'POST', body: { thinking } }); }
  catch (e) { return appAlert(e.message); }
  setStatus(document.getElementById('thinking-status'), '✓ Saved', 'ok');
}
