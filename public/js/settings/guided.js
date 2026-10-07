/* ═══════════════════════════════════════════════════════
   Settings → Set-up: the guided set-up (modules/guided; TODO P1.5).
   A few plain questions; the answers set things up through what exists —
   install proposals a click installs, provider keys pasted and tested.
   The plan it produces is drawn by settings/guided-plan.js.
   ═══════════════════════════════════════════════════════ */

let _guided = null;   // GET /api/guided: the machine, the questions, the picks, the answers kept

async function guidedLoad() {
  const panel = document.getElementById('sp-guided');
  if (!panel) return;
  panel.innerHTML = '<div class="card"><div class="card-title">Set-up</div><p class="guided-muted">Looking at this machine…</p></div>';
  try { _guided = await apiFetch('/api/guided'); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="card-title">Set-up</div><p style="color:var(--red)">${escHtml(e.message)}</p></div>`; return; }
  const g = _guided, a = g.answers || {};
  const uses = new Set(a.uses || ['talk']), devices = new Set(a.devices || ['browser']);
  const box = (name, id, label, on) => `<label class="guided-choice"><input type="checkbox" name="${name}" value="${escHtml(id)}"${on ? ' checked' : ''}> ${escHtml(label)}</label>`;
  const routeQ = g.shapeHere === 'local'
    ? `<div class="guided-q"><div class="guided-q-title">2. Where should it run?</div>
        <label class="guided-choice"><input type="radio" name="guided-route" value="local"${a.route !== 'providers' ? ' checked' : ''}> On this machine where it fits — private, nothing to pay; providers only for what it cannot run</label>
        <label class="guided-choice"><input type="radio" name="guided-route" value="providers"${a.route === 'providers' ? ' checked' : ''}> Online providers for everything — you paste a key, they bill you, nothing big is installed here</label></div>`
    : g.have?.chat
      ? `<div class="guided-q"><div class="guided-q-title">2. Where it runs</div>
        <p class="guided-muted">DOCA's agent already has a model — <b>${escHtml(g.have.chat.model)}</b> on ${escHtml(g.have.chat.provider)} — and it answers. Nothing heavy is installed here.</p></div>`
      : `<div class="guided-q"><div class="guided-q-title">2. Where it runs</div>
        <p class="guided-muted">This machine cannot run the agent's model well, so DOCA will use a model elsewhere: an online provider's (you paste a key below), or one you already run on another machine (its address below). Nothing heavy is installed here.</p></div>`;
  panel.innerHTML = `<div class="card guided">
    <div class="card-title">Set-up</div>
    <p class="guided-lead">Say what you want DOCA for. It looks at this machine, picks what fits, and sets up only that — every install waits for your click, every online service for your key.</p>
    <div class="guided-machine"><b>This machine:</b> ${escHtml(g.machine.summary)}<br>
      <span class="guided-muted">${g.shapeHere === 'local' ? 'It can run its own models.' : 'It is best used with online providers (a "preset" hub).'}
      Suggestions: list v${escHtml(String(g.suggestions.version))}, ${escHtml(g.suggestions.source)}, ${escHtml(g.suggestions.updated)}.</span>
      ${g.have?.chat ? `<br><span style="color:var(--green)">✓ DOCA has a model: ${escHtml(g.have.chat.model)} on ${escHtml(g.have.chat.provider)}, and it answers.</span>` : ''}</div>
    <div class="guided-q"><div class="guided-q-title">1. What do you want DOCA for?</div>
      ${g.uses.map(u => box('guided-use', u.id, u.label, uses.has(u.id))).join('')}
      <textarea id="guided-free" class="input guided-free" rows="2" placeholder="Anything else, in your own words (optional)">${escHtml(a.free || '')}</textarea></div>
    ${routeQ}
    <div class="guided-q"><div class="guided-q-title">3. Where will you use it?</div>
      ${g.devices.map(d => box('guided-device', d.id, d.label, devices.has(d.id))).join('')}</div>
    <div class="guided-actions">
      <button class="btn btn-sm btn-blue" onclick="guidedApply(this)">Set it up</button>
      <button class="btn btn-sm" onclick="guidedPreview(this)">Only show what it would do</button>
      <button class="btn btn-sm" onclick="guidedAskAgent()" title="The same, as a conversation">Ask the agent instead</button>
      <span class="status-line" id="guided-status"></span>
    </div>
    ${g.mode === 'advanced' ? '<p class="guided-muted">This hub was set up by hand (advanced). Nothing here changes that: it only adds what you choose.</p>' : ''}
  </div><div id="guided-plan"></div>`;
  if (g.answers || g.have?.chat) guidedPreview();
}

function guidedAnswers() {
  const q = sel => [...document.querySelectorAll(sel)];
  return {
    uses: q('input[name="guided-use"]:checked').map(i => i.value),
    devices: q('input[name="guided-device"]:checked').map(i => i.value),
    route: document.querySelector('input[name="guided-route"]:checked')?.value || 'local',
    free: document.getElementById('guided-free')?.value || '',
  };
}

async function guidedPreview() {
  const st = document.getElementById('guided-status');
  try { guidedPlanRender(await apiFetch('/api/guided/plan', { method: 'POST', body: { answers: guidedAnswers() } }), false); setStatus(st, '', ''); }
  catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function guidedApply() {
  const st = document.getElementById('guided-status');
  setStatus(st, 'setting up…', '');
  try {
    const plan = await apiFetch('/api/guided/apply', { method: 'POST', body: { answers: guidedAnswers() } });
    guidedPlanRender(plan, true);
    setStatus(st, '✓ Kept your answers. Below: what waits for your click or your key.', 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/** The same request as a conversation: the agent follows the guided-setup skill. */
async function guidedAskAgent() {
  // On a new hub the agent has no model yet — giving it one is what this page is for — and the chat would only
  // answer with an error sending the person back here.
  try {
    if (!(await apiFetch('/api/harness/status')).ready)
      return setStatus(document.getElementById('guided-status'), 'The agent has no model yet: that is what this page sets up. Press Set it up, or use a key below — then the agent can take over.', 'warn', { clear: 0 });
  } catch { /* asking anyway: the chat says what is wrong */ }
  const a = guidedAnswers();
  const names = Object.fromEntries((_guided?.uses || []).map(u => [u.id, u.label.toLowerCase()]));
  const what = [...a.uses.map(u => names[u] || u), a.free].filter(Boolean).join('; ');
  if (typeof chatOpen !== 'undefined' && !chatOpen) toggleChat();
  const input = document.getElementById('chat-input');
  if (!input || typeof chatSend !== 'function') return;
  input.value = `Set me up for: ${what || 'everyday help'}.${a.route === 'providers' ? ' I would rather use online providers.' : ''}`;
  chatSend();
}

/** The first-run choice, on a new hub: guided or advanced. Advanced is the panel as it is; nothing else changes. */
async function guidedWelcome() {
  if (typeof SOLO_PAGE !== 'undefined' && SOLO_PAGE) return;
  try {
    const me = await apiFetch('/api/auth/me');
    if (!me?.rights?.includes('host')) return;
    if ((await apiFetch('/api/guided/state')).mode) return;
  } catch { return; }
  if (document.getElementById('guided-welcome')) return;
  const ov = Object.assign(document.createElement('div'), { id: 'guided-welcome', className: 'modal-overlay' });
  ov.innerHTML = `<div class="modal guided-welcome"><div class="modal-title">Welcome — how would you like to set up?</div>
    <button class="guided-pick" onclick="guidedWelcomeChoose('guided')"><b>Guided</b><span>A few plain questions. It looks at this machine and sets up only what you need; you click to install and paste keys for online services.</span></button>
    <button class="guided-pick" onclick="guidedWelcomeChoose('advanced')"><b>Advanced</b><span>Every setting, by hand. You can open the guided set-up any time from Settings → Set-up.</span></button></div>`;
  document.body.appendChild(ov);
}

async function guidedWelcomeChoose(mode) {
  try { await apiFetch('/api/guided/choose', { method: 'POST', body: { mode } }); } catch { /* asked again next time */ }
  document.getElementById('guided-welcome')?.remove();
  if (mode === 'guided') { nav('settings'); settingsSubNav('guided'); }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => {
    // Its panel is made here: index.html is at its line ceiling.
    if (!document.getElementById('sp-guided')) document.getElementById('sp-general')?.after(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-guided' }));
  });
  window.addEventListener('load', () => { if (document.getElementById('chat-fab')) setTimeout(guidedWelcome, 800); });
}
