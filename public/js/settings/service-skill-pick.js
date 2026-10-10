/* Field → Connectors → API services → Advanced → its skill: the skill that says when and why agents use the service.
   A search over this machine's skills and the public collections (modules/harness/skill-online.js: Anthropic's,
   OpenAI's, Superpowers, Hugging Face's) — one from a collection is looked at and imported with a click, then linked —
   and "✨ Write one from the docs", which opens the chat with a request for the agent's draft (service_draft), sent by
   the person; the draft comes back to this same form ("Prepared by the agent", and a notice linking to it). */
let _svcSkills = [];

function serviceSkillHtml(skills) {
  _svcSkills = skills || [];
  return `<div class="svc-skill">
    <label class="svc-field svc-wide"><span>Its skill — when and why agents use it</span>
      <select class="input" id="sk-skill" data-default="" data-label="Its skill"><option value="">no skill linked</option>${_svcSkills.map(s => `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`).join('')}</select></label>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="sk-skill-q" placeholder="Search skills — here and in the public collections" style="flex:1;min-width:200px"
        onkeydown="if(event.key==='Enter'){event.preventDefault();serviceSkillSearch()}" oninput="serviceSkillLocal()">
      <button class="btn btn-xs" onclick="serviceSkillSearch()">Search</button>
      <button class="btn btn-xs" onclick="serviceAskSkill()" title="Opens the chat with the request; you send it">✨ Write one from the docs</button></div>
    <div id="sk-skill-hits" class="svc-skill-hits"></div></div>`;
}

/** This machine's skills that match, as you type. */
function serviceSkillLocal() {
  const q = (document.getElementById('sk-skill-q')?.value || '').trim().toLowerCase();
  const box = document.getElementById('sk-skill-hits');
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  const here = _svcSkills.filter(s => `${s.name} ${s.description || ''}`.toLowerCase().includes(q)).slice(0, 6);
  box.innerHTML = here.length ? `<div class="desc">On this machine:</div>${here.map(s => `<div class="svc-skill-hit"><button class="btn btn-xs" onclick="serviceSkillLink(${jsArg(s.name)})">Link</button>
    <b>${escHtml(s.name)}</b> <span class="desc">${escHtml(String(s.description || '').slice(0, 140))}</span></div>`).join('')}` : '<div class="desc">None here by that word — Search looks in the public collections too.</div>';
}

/** Here and in the public collections (host). */
async function serviceSkillSearch() {
  serviceSkillLocal();
  const q = (document.getElementById('sk-skill-q')?.value || '').trim();
  const box = document.getElementById('sk-skill-hits');
  const more = document.createElement('div');
  more.innerHTML = '<div class="desc pulse">Reading the public collections…</div>';
  box.append(more);
  let r;
  try { r = await apiFetch(`/api/harness/skills/online?q=${encodeURIComponent(q)}`); } catch (e) { more.innerHTML = `<div class="desc">${escHtml(e.message)}</div>`; return; }
  const hits = (r.results || []).slice(0, 8);
  more.innerHTML = `<div class="desc">In the public collections:${(r.failed || []).length ? ` (not read: ${escHtml(r.failed.join(', '))})` : ''}</div>`
    + (hits.length ? hits.map((k, i) => `<div class="svc-skill-hit"><button class="btn btn-xs" data-i="${i}">${k.here ? 'Link (here)' : 'Look and import'}</button>
      <b>${escHtml(k.name)}</b> <span class="desc">${escHtml(k.source)} — ${escHtml(String(k.description || '').slice(0, 140))}</span></div>`).join('') : '<div class="desc">No skill there mentions that.</div>');
  more.querySelectorAll('button[data-i]').forEach(b => { b.onclick = () => serviceSkillTake(hits[Number(b.dataset.i)], b.closest('.svc-skill-hit')); });
}

/** A public skill: linked when it is here, else its dry run (skills-online.js) — imported and linked on Import. */
async function serviceSkillTake(k, row) {
  if (k.here) return serviceSkillLink(k.name);
  if (typeof skillsOnlinePlan !== 'function') return;
  await skillsOnlinePlan(k, row);
  const imp = row.nextElementSibling?.querySelector('[data-imp]');
  if (imp) imp.addEventListener('click', () => setTimeout(() => serviceSkillLink(k.name), 1200));
}

function serviceSkillLink(name) {
  const sk = document.getElementById('sk-skill');
  if (!sk) return;
  if (![...sk.options].some(o => o.value === name)) sk.add(new Option(name, name));
  sk.value = name;
  sk.dispatchEvent(new Event('change', { bubbles: true }));
  const box = document.getElementById('sk-skill-hits');
  if (box) box.innerHTML = `<div class="desc">✓ Linked: ${escHtml(name)}.</div>`;
}

/** The agent's draft, from the docs link when there is one: it lands in this form under "Prepared by the agent". */
function serviceAskSkill() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const name = v('sk-name') || 'this service', docs = v('sk-docs') || _svcForm.docs || v('sk-origin');
  serviceAskAgent(`Write a skill for the API service "${name}"${docs ? ` from its documentation at ${docs}` : ''}: when to use it, which actions, and how to show what they make. `
    + 'Prepare it with service_draft (with its actions) so I can check it in the form and save it — I will paste the key there.');
}
