/* ═══════════════════════════════════════════════════════
   What a conversation carries beyond its mode and model, beside them in its
   bar (asked 2026-10-09): ✦ the skills attached to it, each saying where it came
   from (this chat, the project, Settings — modules/harness/skill-use.js), with
   a search to add one; ⟳ a loop running in it (/loop, schedules/loop.js) with
   its next run and ■; and ⋯ — its own compaction (turn/compact-choice.js),
   Compact now, whether skills its trigger words suggest are attached without
   asking (skill-next.js), and the slash commands.
   ═══════════════════════════════════════════════════════ */

const _convSid = id => `/api/harness/sessions/${encodeURIComponent(id)}`;

/** The product's name as the panel shows it (branding.js), never a literal. */
function convBrand() { return (typeof BRAND !== 'undefined' && BRAND?.product) || document.querySelector('[data-brand]')?.textContent || 'The hub'; }

/** A small panel under `anchor`; closes on a click elsewhere or Escape. Returns its element. */
function convPop(anchor, html) {
  document.querySelectorAll('.conv-pop').forEach(p => p.remove());
  const pop = document.createElement('div');
  pop.className = 'conv-pop';
  pop.innerHTML = html;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 16);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pop.style.top = `${r.bottom + 4 + window.scrollY}px`;
  const close = e => {
    if (e.type === 'keydown' ? e.key !== 'Escape' : pop.contains(e.target) || anchor.contains(e.target)) return;
    pop.remove(); document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', close, true);
  };
  setTimeout(() => { document.addEventListener('mousedown', close, true); document.addEventListener('keydown', close, true); });
  return pop;
}

async function _convSave(sessionId, body, redraw) {
  try { await apiFetch(`${_convSid(sessionId)}/settings`, { method: 'POST', body }); } catch (e) { appAlert(e.message); }
  redraw?.();
}

/** Draw ✦ ⟳ ⋯ into `host` for `sessionId`; `redraw` draws the whole bar again after a change. */
async function convExtras(host, sessionId, redraw) {
  if (!host || !sessionId) return;
  const [att, loops] = await Promise.all([
    apiFetch(`${_convSid(sessionId)}/skills`).catch(() => null),
    apiFetch('/api/schedules').then(r => (r.schedules || []).filter(s => s.kind === 'loop' && s.sessionId === sessionId && s.state === 'on')).catch(() => []),
  ]);
  const n = att?.skills?.length || 0;
  host.innerHTML = `<button class="btn btn-xs conv-skills" title="${escHtml(n ? `Skills attached here: ${att.skills.map(s => `${s.name} (${s.where})`).join(', ')}` : 'No skill is attached to this chat')}">✦ ${n || ''} skill${n === 1 ? '' : 's'}</button>
    ${loops.map(l => `<span class="conv-loop" title="${escHtml(`${l.message}\n${l.whenText}, run ${l.runs || 0} of ${l.max}`)}">⟳ ${l.nextAt ? `next ${new Date(l.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'running'}
      <button class="btn btn-xs conv-loop-stop" data-id="${escHtml(l.id)}" title="Stop this loop">■</button></span>`).join('')}
    <button class="btn btn-xs conv-more" title="This chat's compaction, suggested skills and commands">⋯</button>`;
  host.querySelector('.conv-skills').onclick = e => convSkillsPop(e.currentTarget, sessionId, att, redraw);
  host.querySelectorAll('.conv-loop-stop').forEach(b => { b.onclick = async () => {
    try { await apiFetch(`/api/schedules/${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    redraw?.();
  }; });
  host.querySelector('.conv-more').onclick = e => convMorePop(e.currentTarget, sessionId, redraw);
}

/** ✦: what is attached and from where, with × for each, and a search over every skill to add one. */
async function convSkillsPop(anchor, sessionId, att, redraw) {
  const rows = (att?.skills || []).map(s => `<div class="conv-pop-row"><span><b>${escHtml(s.name)}</b> <span class="muted">· ${escHtml(s.where)}</span></span>
    <button class="btn btn-xs" data-rm="${escHtml(s.name)}" title="Detach it from this chat">×</button></div>`).join('');
  const pop = convPop(anchor, `<div class="conv-pop-title">Skills attached to this chat <span class="muted">(${escHtml(att?.mode || 'agent')} mode)</span></div>
    ${rows || '<div class="muted">None. A skill attached here goes with every turn of this chat.</div>'}
    <input class="input conv-skill-q" placeholder="Search skills to attach…" style="width:100%;margin-top:8px">
    <div class="conv-skill-hits"></div>
    <div class="muted" style="margin-top:6px">Which skills go with each mode by default: Settings → Harness → Skills.</div>`);
  pop.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => { pop.remove(); _convSave(sessionId, { skills: { remove: [b.dataset.rm] } }, redraw); }; });
  let all = [];
  try { all = (await apiFetch('/api/harness/skills')).skills || []; } catch { /* the search just finds nothing */ }
  const q = pop.querySelector('.conv-skill-q'), hits = pop.querySelector('.conv-skill-hits');
  const draw = () => {
    const w = q.value.trim().toLowerCase(), have = new Set((att?.skills || []).map(s => s.name));
    const list = all.filter(s => !have.has(s.name) && (!w || `${s.name} ${s.description}`.toLowerCase().includes(w))).slice(0, 8);
    hits.innerHTML = list.map(s => `<button class="conv-pop-hit" data-add="${escHtml(s.name)}" title="${escHtml(s.description)}"><b>${escHtml(s.name)}</b> <span class="muted">${escHtml(s.description.length > 70 ? `${s.description.slice(0, 68)}…` : s.description)}</span></button>`).join('');
    hits.querySelectorAll('[data-add]').forEach(b => { b.onclick = () => { pop.remove(); _convSave(sessionId, { skills: { add: [b.dataset.add] } }, redraw); }; });
  };
  q.oninput = draw;
  draw();
  q.focus();
}

/** ⋯: this chat's compaction, Compact now, auto-accepting suggested skills, and the slash commands. */
async function convMorePop(anchor, sessionId, redraw) {
  let v = null;
  try { v = (await apiFetch(_convSid(sessionId))).session; } catch { /* drawn with defaults */ }
  const c = v?.compact || null, mode = !c ? '' : c.off ? 'off' : 'own';
  const auto = v?.skillAuto === true ? 'on' : v?.skillAuto === false ? 'off' : '';
  const pop = convPop(anchor, `<div class="conv-pop-title">This chat</div>
    <label class="conv-pop-field">Compaction
      <select class="input conv-c-mode"><option value="" ${mode === '' ? 'selected' : ''}>As the harness (Settings)</option>
        <option value="own" ${mode === 'own' ? 'selected' : ''}>This chat's own</option>
        <option value="off" ${mode === 'off' ? 'selected' : ''}>Never fold early</option></select></label>
    <div class="conv-c-own" ${mode === 'own' ? '' : 'hidden'}>
      <label class="conv-pop-field">Fold at % of the window <input class="input conv-c-at" type="number" min="10" max="95" value="${c?.at || ''}" placeholder="60"></label>
      <label class="conv-pop-field">or after messages <input class="input conv-c-after" type="number" min="8" max="2000" value="${c?.after || ''}" placeholder="40"></label></div>
    <div class="conv-pop-actions"><button class="btn btn-xs conv-c-save">Save</button>
      <button class="btn btn-xs conv-c-now" title="Fold the earlier messages into this chat's summary now (/compact)">Compact now</button></div>
    <label class="conv-pop-field" title="When a message names a skill by one of its trigger words">Skills ${escHtml(convBrand())} suggests
      <select class="input conv-auto"><option value="" ${auto === '' ? 'selected' : ''}>As the default</option>
        <option value="on" ${auto === 'on' ? 'selected' : ''}>Attach without asking</option>
        <option value="off" ${auto === 'off' ? 'selected' : ''}>Ask with a chip</option></select></label>
    <div class="muted conv-pop-cmds">Type in the chat: <code>/loop 10m …</code> runs it again until done (<code>/loop stop</code>) ·
      <code>/compact</code> · <code>/skill name</code> attaches a skill</div>`);
  const sel = pop.querySelector('.conv-c-mode');
  sel.onchange = () => { pop.querySelector('.conv-c-own').hidden = sel.value !== 'own'; };
  pop.querySelector('.conv-c-save').onclick = () => {
    const compact = sel.value === 'off' ? { off: true } : sel.value === 'own' ? { at: pop.querySelector('.conv-c-at').value || null, after: pop.querySelector('.conv-c-after').value || null } : null;
    pop.remove(); _convSave(sessionId, { compact }, redraw);
    if (typeof _hcStatus === 'function') setTimeout(_hcStatus, 300);   // the ring's fold point is this chat's now
  };
  pop.querySelector('.conv-c-now').onclick = async () => {
    pop.remove();
    try { appAlert((await apiFetch(`${_convSid(sessionId)}/compact`, { method: 'POST' })).text); } catch (e) { appAlert(e.message); }
  };
  pop.querySelector('.conv-auto').onchange = e => { const x = e.target.value; _convSave(sessionId, { skillAuto: x === 'on' ? true : x === 'off' ? false : null }); };
}
