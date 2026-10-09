/* ═══════════════════════════════════════════════════════
   A conversation's own switches, in one row above its chat (asked 2026-10-04):
   how it works (Agent · Plan · Ask · Debug — modules/harness/modes.js),
   whether it asks before acting (the panel's setting, or Auto / Manual for
   this conversation alone — a host's switch, hidden without host), and the
   model it runs on (chatModelPicker); then its skills, loop and compaction
   (agent-ui/conv-extras.js).
   ═══════════════════════════════════════════════════════ */

const CONV_MODES = [['agent', 'Agent', 'Does the work'], ['plan', 'Plan', 'Reads and proposes a plan; changes nothing until you approve it'],
  ['ask', 'Ask', 'Answers questions; reads only'], ['debug', 'Debug', 'Reproduce, find the cause, fix it, prove it']];

/** Draw the row for `sessionId`; `view` is its session view (mode, approval) when already loaded. */
async function agentConvBar(host, sessionId, view = null, { model = true, think = null } = {}) {
  if (!host || !sessionId) return;
  const v = view || await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}`).then(r => r.session).catch(() => null);
  if (!v) return;
  if (think && typeof thinkToggleBind === 'function') thinkToggleBind(think, sessionId, v);   // the composer's 💭 (agent-ui/think-toggle.js)
  const mode = v.mode || 'agent', approval = v.approval || '';
  host.innerHTML = `<select class="input conv-mode" title="${escHtml(CONV_MODES.find(m => m[0] === mode)?.[2] || '')}">
      ${CONV_MODES.map(([k, l, t]) => `<option value="${k}" title="${escHtml(t)}" ${k === mode ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select class="input conv-approval host-only" title="Whether this conversation asks before it acts">
      <option value="" ${approval ? '' : 'selected'}>Asks first: as in Settings</option>
      <option value="auto" ${approval === 'auto' ? 'selected' : ''}>Acts without asking</option>
      <option value="manual" ${approval === 'manual' ? 'selected' : ''}>Asks me before acting</option></select>
    ${model ? '<span class="chat-model-host conv-model"></span>' : ''}
    <span class="conv-extras"></span>
    <button class="btn btn-xs conv-trace" title="How this conversation's turns went: each step, tool and wait, with times and tokens">⏱</button>`;
  const save = async body => {
    try { await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}/settings`, { method: 'POST', body }); }
    catch (e) { appAlert(e.message); }
    agentConvBar(host, sessionId, null, { model, think });
  };
  host.querySelector('.conv-mode').onchange = e => save({ mode: e.target.value });
  host.querySelector('.conv-approval').onchange = e => save({ approval: e.target.value || null });
  host.querySelector('.conv-trace').onclick = () => traceOpen(sessionId);
  if (model) chatModelPicker(host.querySelector('.conv-model'), sessionId);
  convExtras(host.querySelector('.conv-extras'), sessionId, () => agentConvBar(host, sessionId, null, { model, think }));   // ✦ skills, ⟳ loop, ⋯ (conv-extras.js)
}

/**
 * The model a conversation runs on, and whether it may fall back — a select and
 * a toggle, used by the project's chat and the Harness console
 * (POST /api/harness/sessions/:id/model, harness/turn/choice.js). Fallback
 * follows the harness's order from the chosen model onward.
 */
async function chatModelPicker(host, sessionId) {
  if (!host || !sessionId) return;
  if (host.dataset.session === sessionId && host.contains(document.activeElement)) return;   // being used: leave it open
  host.dataset.session = sessionId;
  let v;
  try { v = await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}/model`); } catch { host.innerHTML = ''; return; }
  const key = e => `${e.provider}/${e.model}`;
  const shown = e => (e.model ? key(e) : `${e.provider} · no model`);
  const chosen = v.choice?.model ? key(v.choice) : '';
  const opts = [`<option value="">Default · ${escHtml(shown(v.order[0]))}</option>`,
    ...v.order.slice(1).map(e => `<option value="${escHtml(key(e))}">${escHtml(key(e))}</option>`),
    ...(chosen && !v.order.some(e => key(e) === chosen) ? [`<option value="${escHtml(chosen)}">${escHtml(chosen)}</option>`] : []),
    '<option value="__other">Other…</option>'];
  host.innerHTML = `<select class="input chat-model" title="The model this conversation runs on">${opts.join('')}</select>
    <label class="chat-fallback" title="${escHtml(v.effective.fallback.length ? `Then: ${v.effective.fallback.join(' → ')}` : 'No fallback: the chosen model alone')}">
      <input type="checkbox" ${v.choice?.fallback === false ? '' : 'checked'}> fallback</label>`;
  const sel = host.querySelector('select'), box = host.querySelector('input');
  sel.value = chosen;
  const save = async (provider, model) => {
    try { await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}/model`, { method: 'POST', body: { provider, model, fallback: box.checked } }); }
    catch (e) { appAlert(e.message); }
    chatModelPicker(host, sessionId);
    if (typeof _hcStatus === 'function' && typeof _hcSession !== 'undefined' && _hcSession === sessionId) _hcStatus();
  };
  const split = val => { const i = val.indexOf('/'); return [val.slice(0, i), val.slice(i + 1)]; };
  sel.onchange = () => {
    if (sel.value === '__other') {
      sel.value = chosen;
      return appPrompt('Model for this conversation, as provider/model (e.g. openai/gpt-5.1):', val => {
        const [pr, m] = split(val);
        if (!pr || !m) return appAlert('Write it as provider/model.');
        save(pr, m);
      }, chosen || `${v.order[0].provider}/`);
    }
    const [pr, m] = sel.value ? split(sel.value) : ['', ''];
    save(pr, m);
  };
  box.onchange = () => { const [pr, m] = sel.value ? split(sel.value) : ['', '']; save(pr, m); };
}
