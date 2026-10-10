/* Field → Connectors → API services → Advanced → its skill: the skill that says when and why agents use the service.
   A search over this machine's skills and the public collections (modules/harness/skill-online.js: Anthropic's,
   OpenAI's, Superpowers, Hugging Face's) — one from a collection is looked at and imported with a click, then linked —
   and "✨ Write one from the docs", which opens the chat with a request the person sends, naming the service, its
   address, docs and actions: for a saved service the agent writes the skill (the skill tool), and the form links it
   when it appears — Save keeps the link; for one not saved yet, the agent prepares the whole service with service_draft
   and it comes back to this same form ("Prepared by the agent", and a notice linking to it). */
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

function serviceSkillLink(name, said = `✓ Linked: ${escHtml(name)} — ${_svcForm.editing ? 'Save keeps it' : 'kept with the service on Add'}.`) {
  _svcForm.values['sk-skill'] = name;
  if (!_svcForm.touched.includes('sk-skill')) _svcForm.touched.push('sk-skill');
  const sk = document.getElementById('sk-skill');
  if (sk) {
    if (![...sk.options].some(o => o.value === name)) sk.add(new Option(name, name));
    sk.value = name;
    sk.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const box = document.getElementById('sk-skill-hits');
  if (box) box.innerHTML = `<div class="desc">${said}</div>`;
  serviceFormFoot();
}

/** The request for the agent, named: the service, where it is, its docs, its actions. Sent by the person. */
function serviceAskSkill() {
  const f = _svcForm, v = id => String(f.values[id] || '').trim();
  const name = v('sk-name').toLowerCase();
  if (!name) return askFor(document.getElementById('sk-name'), 'Name the service first, or Edit a saved one: the skill is written for it.');
  const docs = v('sk-docs') || f.docs, origin = v('sk-origin');
  const what = `"${name}"${f.title && f.title.toLowerCase() !== name ? ` (${f.title})` : ''}${origin ? ` at ${origin}` : ''}${docs ? `, documented at ${docs}` : ''}`;
  const acts = f.actions || [];
  const actsLine = acts.length ? ` Its actions: ${acts.map(a => `${a.name}${a.job ? ' (a long job)' : ''}`).join(', ')}.` : ' It has no actions set up yet.';
  if (f.editing === name) {
    const skill = v('sk-skill') || name;
    serviceAskAgent(`Write a skill for my API service ${what}.${actsLine} \`service describe ${name}\` gives each action in full. `
      + `Say when to use it, which action does what, and how to show what they make. Keep it with the skill tool (write) named "${skill}"`
      + `${v('sk-skill') ? ' — it replaces the skill linked to it now' : ''}. Leave the service itself as it is: I link the skill to it in its form and save.`);
    if (!v('sk-skill')) serviceSkillAwait(name, skill);
    return;
  }
  serviceAskAgent(`Write a skill for the API service ${what}.${actsLine} Say when to use it, which actions, and how to show what they make. `
    + 'Prepare it with service_draft (with its actions and the skill) so I can check it in the form and save it — I will paste the key there.');
}

/** After ✨ on a saved service: the skill the agent writes is linked in the form when it appears (Save keeps it). */
let _svcSkillWait = null;
function serviceSkillAwait(service, skill) {
  clearInterval(_svcSkillWait);
  const until = Date.now() + 15 * 60000;
  const box = document.getElementById('sk-skill-hits');
  if (box) box.innerHTML = `<div class="desc">Waiting for the agent's skill “${escHtml(skill)}” — it is linked here when it is written.</div>`;
  _svcSkillWait = setInterval(async () => {
    if (Date.now() > until || _svcForm.editing !== service || _svcForm.values['sk-skill']) return clearInterval(_svcSkillWait);
    let list;
    try { list = (await apiFetch('/api/harness/skills')).skills || []; } catch { return; }
    if (!list.some(s => s.name === skill)) return;
    clearInterval(_svcSkillWait);
    _svcSkills = list;
    serviceSkillLink(skill, `✓ The agent wrote “${escHtml(skill)}” — linked here; Save keeps it.`);
  }, 4000);
}
