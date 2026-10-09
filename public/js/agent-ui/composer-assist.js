/* ═══════════════════════════════════════════════════════
   Above each chat's composer (the floating chat, the Harness console, a
   Projects chat), as the person types (asked 2026-10-09):
   - "/" lists the slash commands (modules/harness/slash.js), a click fills one;
   - a skill the message names by one of its trigger words shows as a chip —
     "<product> suggests: X", a tap attaches it to this message, ✕ dismisses
     it — or, where suggested skills are attached without asking, "attached: X"
     with ✕ to leave it out of this message (modules/harness/skill-next.js).
   Matching is the hub's, mechanical (GET /api/harness/skills/suggest), asked
   once the typing pauses; no model reads what is typed.
   ═══════════════════════════════════════════════════════ */

const COMPOSER_SESSIONS = {
  'chat-input': () => 'main',                                                       // the floating chat: the Orchestrator's
  'hc-input': () => (typeof _hcSession !== 'undefined' ? _hcSession : null),
  'pj-chat-in': () => (typeof PJC !== 'undefined' ? PJC.active : null),
};
// The hub's list (slash.js COMMANDS), drawn without asking it; test/chat-kit-ui.test.js holds the two equal.
const COMPOSER_COMMANDS = [
  { name: 'loop', usage: '/loop 10m ', what: 'run it again in this chat until it is done (/loop self: as soon as a run ends; /loop stop)' },
  { name: 'compact', usage: '/compact', what: 'fold the earlier messages of this chat into its summary now' },
  { name: 'skill', usage: '/skill ', what: 'attach a skill to this chat (/skill -name detaches it)' },
];

/**
 * The chips to draw: each suggestion not dismissed, as `attached` (auto-accept), `added` (tapped) or `suggested`.
 * Pure, so the rule "a dismissed chip is never attached" is testable without a page.
 */
function composerChips(suggestions, { auto = false, dismissed = new Set(), added = new Set() } = {}) {
  return (suggestions || []).filter(s => !dismissed.has(s.name))
    .map(s => ({ ...s, state: auto ? 'attached' : added.has(s.name) ? 'added' : 'suggested' }));
}

function _assistBox(t) {
  if (t._assist?.isConnected) return t._assist;
  const box = document.createElement('div');
  box.className = 'composer-assist';
  (t.closest('.pj-chat-input, .chat-input-row, .hc-input-row') || t.parentElement).before(box);
  t._assist = box;
  t._assistState = { dismissed: new Set(), added: new Set(), last: '' };
  return box;
}

async function _assistPost(sessionId, skillsNext) {
  try { await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}/settings`, { method: 'POST', body: { skillsNext } }); } catch { /* the chip is a suggestion */ }
}

function _assistSlash(t, box) {
  const v = t.value;
  const word = v.slice(1).split(/\s/)[0].toLowerCase();
  const list = COMPOSER_COMMANDS.filter(c => c.name.startsWith(word));
  box.innerHTML = list.map(c => `<button class="composer-cmd" data-u="${escHtml(c.usage)}"><code>/${c.name}</code> <span class="muted">${escHtml(c.what)}</span></button>`).join('');
  box.querySelectorAll('[data-u]').forEach(b => { b.onmousedown = e => { e.preventDefault(); t.value = b.dataset.u; t.focus(); composerAssist(t); }; });
}

async function _assistSkills(t, box) {
  const st = t._assistState, text = t.value.trim();
  const sid = COMPOSER_SESSIONS[t.id]?.();
  if (text.length < 4 || !sid) { box.innerHTML = ''; return; }
  if (text === st.last && st.data) return draw();
  let data;
  try { data = await apiFetch(`/api/harness/skills/suggest?q=${encodeURIComponent(text.slice(0, 2000))}&session=${encodeURIComponent(sid)}`); } catch { box.innerHTML = ''; return; }
  if (t.value.trim() !== text) return;   // typed on meanwhile: the next pause asks again
  Object.assign(st, { last: text, data });
  draw();
  function draw() {
    const chips = composerChips(st.data.suggestions, { auto: st.data.auto?.on, dismissed: st.dismissed, added: st.added });
    const brand = typeof convBrand === 'function' ? convBrand() : 'The hub';
    box.innerHTML = chips.map(c => `<span class="composer-chip ${c.state}" title="${escHtml(`${c.description || ''}\nmatched "${c.matched}"${c.state === 'attached' ? ` · attached without asking (${st.data.auto.from})` : ''}`)}">
      ${c.state === 'suggested' ? `<button class="composer-chip-add" data-n="${escHtml(c.name)}">${escHtml(brand)} suggests: <b>${escHtml(c.name)}</b></button>`
        : `<span>${c.state === 'attached' ? 'attached' : '✓ for this message'}: <b>${escHtml(c.name)}</b></span>`}
      <button class="composer-chip-x" data-x="${escHtml(c.name)}" title="${c.state === 'suggested' ? 'Dismiss' : 'Leave it out of this message'}">✕</button></span>`).join('');
    box.querySelectorAll('[data-n]').forEach(b => { b.onclick = () => { st.added.add(b.dataset.n); _assistPost(st.data.sessionId, { add: [b.dataset.n] }); draw(); }; });
    box.querySelectorAll('[data-x]').forEach(b => { b.onclick = () => {
      const n = b.dataset.x;
      if (st.data.auto?.on) _assistPost(st.data.sessionId, { skip: [n] });
      else if (st.added.has(n)) _assistPost(st.data.sessionId, { unadd: [n] });
      st.added.delete(n); st.dismissed.add(n); draw();
    }; });
  }
}

/** Redraw the hints for composer `t`. */
function composerAssist(t) {
  const box = _assistBox(t), st = t._assistState;
  clearTimeout(t._assistTimer);
  if (!t.value.trim()) { box.innerHTML = ''; st.dismissed.clear(); st.added.clear(); st.last = ''; st.data = null; return; }   // sent, or cleared: start again
  if (t.value.startsWith('/') && !/\s/.test(t.value.trim().slice(1)) && !t.value.includes('\n')) return _assistSlash(t, box);
  if (t.value.startsWith('/')) { box.innerHTML = ''; return; }
  t._assistTimer = setTimeout(() => _assistSkills(t, box), 450);
}

// Only in a page (a test's DOM stub loads this file too).
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('input', e => { if (COMPOSER_SESSIONS[e.target?.id]) composerAssist(e.target); });
  // A send clears the box without an input event; look again shortly after Enter or a click on Send.
  document.addEventListener('keyup', e => { if (e.key === 'Enter' && COMPOSER_SESSIONS[e.target?.id] && !e.target.value.trim()) composerAssist(e.target); });
  document.addEventListener('click', () => setTimeout(() => {
    for (const id of Object.keys(COMPOSER_SESSIONS)) { const t = document.getElementById(id); if (t?._assist && !t.value.trim() && t._assist.innerHTML) composerAssist(t); }
  }, 60));
}
