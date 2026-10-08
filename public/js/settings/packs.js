/* ═══════════════════════════════════════════════════════
   Settings → Packs (modules/packs; TODO H4): what this hive made, in one
   .dpack another hive imports — skills, specialists, recipes, MCP servers,
   memory and its rules, each inside in its own world's format — and bringing
   one in (or a zip of another tool's things): a dry run, then what you choose.
   ═══════════════════════════════════════════════════════ */

let _packFile = null, _packLib = null;   // what the plan below is of: an uploaded file, or a library pack's id

async function packsLoad() {
  const panel = document.getElementById('sp-packs');
  if (!panel) return;
  let c;
  try { c = await apiFetch('/api/packs/contents'); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const group = (kind, title, list) => `<div style="margin-bottom:8px"><div class="input-label">${title}</div>${list.length
    ? list.map(x => `<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;font-size:12px" title="${escHtml(x.label || '')}">
        <input type="checkbox" data-pack="${kind}" value="${escHtml(x.id)}"> ${escHtml(x.id)}</label>`).join('')
    : '<span style="font-size:11px;color:var(--muted)">none</span>'}</div>`;
  panel.innerHTML = `<div class="card">
      <div class="card-title">Make a pack</div>
      <p style="font-size:11px;color:var(--muted);margin-bottom:10px">One .dpack file (a zip) that another DOCA imports — and that other tools read without DOCA: skills are
        Agent Skills folders, specialists are subagent markdown, MCP servers are the mcpServers JSON Claude Desktop and Cursor read, a shell-only
        recipe comes with a bash and a PowerShell script. Secrets never travel: they are left empty and listed for whoever imports it.</p>
      <div class="toolbar" style="gap:6px;margin-bottom:10px"><input class="input" id="pack-name" placeholder="Pack name" style="flex:1;max-width:280px"></div>
      ${group('skills', 'Skills', c.skills)}${group('specialists', 'Specialists', c.specialists)}${group('recipes', 'Recipes', c.recipes)}${group('mcp', 'MCP servers', c.mcp)}
      <div style="margin-bottom:10px;font-size:12px"><label><input type="checkbox" id="pack-memory"> Memory</label>
        <label style="margin-left:12px"><input type="checkbox" id="pack-rules"> Memory rules (as AGENTS.md)</label></div>
      ${advancedFold(`<div style="margin-bottom:10px;font-size:12px"><div class="input-label">As an edition — what makes it feel like its own product (edition.json)</div>
        <label><input type="checkbox" id="pack-ed-branding" data-default="false" data-label="Names"> Names (branding)</label>
        <label style="margin-left:12px"><input type="checkbox" id="pack-ed-look" data-default="false" data-label="How screens start out"> How screens start out (theme, hidden tabs, sidebar)</label>
        <label style="margin-left:12px"><input type="checkbox" id="pack-ed-face" data-default="false" data-label="The face"> The face</label>
        <label style="margin-left:12px">Level <select class="input" id="pack-ed-level" data-default="" data-label="Level" style="width:auto"><option value="">none</option>
          ${(c.levels || []).map(l => `<option value="${escHtml(l.id)}">${escHtml(l.label)}</option>`).join('')}</select></label></div>`,
        { id: 'pack-edition', label: 'Advanced — as an edition: names, look, face, a level' })}
      <button class="btn btn-sm btn-blue" onclick="packsExport()">⬇ Download the pack</button>
      <button class="btn btn-sm" onclick="packsExport(true)">Keep it in the library</button></div>
    <div class="card" id="pack-library"></div>
    <div class="card">
      <div class="card-title">Bring one in</div>
      <p style="font-size:11px;color:var(--muted);margin-bottom:10px">A .dpack, or a zip of another tool's things: Agent Skills folders, a Claude Desktop / Cursor / Claude Code
        config with mcpServers, AGENTS.md or CLAUDE.md rules. You see what it adds, overwrites and needs before anything is written.
        An MCP server is added switched off.</p>
      <input type="file" id="pack-file" accept=".dpack,.zip" onchange="packsPlan(this.files[0])">
      <div id="pack-plan" style="margin-top:10px"></div></div>`;
  packsLibraryRender();
}

/* The library (packs/library.js): every pack this hive keeps — made here, by the agent, received from another hub —
   and the other hubs it sends to (packs/send.js). */
async function packsLibraryRender() {
  const el = document.getElementById('pack-library');
  if (!el) return;
  let d;
  try { d = await apiFetch('/api/packs/library'); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const hubOpts = d.hubs.map(h => `<option value="${escHtml(h.id)}">${escHtml(h.label)}</option>`).join('');
  el.innerHTML = `<div class="card-title">Library</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Packs this hive keeps: saved here, saved by the agent, or sent by another hub. Nothing in it is applied until you bring it in.</p>
    ${d.packs.map(p => `<div class="disk-row"><span class="disk-label">${escHtml(p.name)} <span style="color:var(--muted)">${escHtml(p.origin)}${p.from ? ` · ${escHtml(p.from)}` : ''} · ${escHtml(p.savedAt.slice(0, 10))}</span></span>
      <span class="disk-path">${escHtml(p.contents.map(c => `${c.kind}${c.id ? ` ${c.id}` : ''}`).join(', ') || (p.native ? 'another tool\'s files' : ''))}</span>
      <span class="disk-free" style="display:flex;gap:4px"><a class="btn btn-xs" href="/api/packs/library/${encodeURIComponent(p.id)}">⬇</a>
        <button class="btn btn-xs" onclick="packsPlan(null, ${jsArg(p.id)})">Bring in…</button>
        ${d.registry ? `<button class="btn btn-xs ${p.published ? 'btn-blue' : ''}" onclick="packsPublish(${jsArg(p.id)}, ${!p.published})" title="Listed to hubs holding a registry token">${p.published ? 'Published' : 'Publish'}</button>` : ''}
        ${d.hubs.length ? `<select class="input" style="width:auto;font-size:11px" onchange="if (this.value) packsSend(${jsArg(p.id)}, this.value); this.value=''"><option value="">Send to…</option>${hubOpts}</select>` : ''}
        <button class="btn btn-xs btn-red" onclick="packsDelete(${jsArg(p.id)})">✕</button></span></div>`).join('') || '<div class="placeholder">Empty.</div>'}
    <div class="card-subtitle" style="margin-top:10px">Other hubs to send to</div>
    <p style="font-size:11px;color:var(--muted)">On the other DOCA: Field → API keys → a token with the <b>hub</b> preset (it can only send packs)${d.registry ? ', or <b>registry</b> (to browse and fetch what it publishes)' : ''}. Its certificate is pinned when you add it.</p>
    ${d.hubs.map(h => `<div class="disk-row"><span class="disk-label">${escHtml(h.label)}</span><span class="disk-path">${escHtml(h.url)}${h.pinned ? ' · pinned' : ''} · ${[h.send && 'send', h.read && 'browse'].filter(Boolean).join(', ')}</span>
      <span class="disk-free" style="display:flex;gap:4px">${d.registry && h.read ? `<button class="btn btn-xs" onclick="packsBrowse(${jsArg(h.id)})">Browse</button>` : ''}<button class="btn btn-xs btn-red" onclick="packsHubRemove(${jsArg(h.id)})">✕</button></span></div>`).join('')}
    <div id="pack-browse"></div>
    <div class="toolbar" style="gap:6px;margin-top:6px;flex-wrap:wrap">
      <input class="input" id="pack-hub-url" placeholder="https://other-hub:4242" style="flex:1;min-width:200px">
      <input class="input" id="pack-hub-token" type="password" autocomplete="off" placeholder="its hub token (doca_…)" style="flex:1;min-width:200px">
      <button class="btn btn-sm" onclick="packsHubAdd()">Add</button></div>`;
  if (typeof sharingRender === 'function') sharingRender();   // the owner's sharing card, above the library
}

/* The registry (experiments.packRegistry): publish from this library; browse another hub's and fetch into this one. */
async function packsPublish(id, on) {
  try { await apiFetch(`/api/packs/library/${encodeURIComponent(id)}/publish`, { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  packsLibraryRender();
}
async function packsBrowse(hub) {
  const el = document.getElementById('pack-browse');
  let d;
  try { d = await apiFetch(`/api/packs/hubs/${encodeURIComponent(hub)}/published`); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  el.innerHTML = `<div class="input-label" style="margin-top:8px">${escHtml(d.hub)} publishes</div>` + (d.packs.map(p => `<div class="disk-row"><span class="disk-label">${escHtml(p.name)}</span>
    <span class="disk-path">${escHtml(p.description || p.contents.map(c => `${c.kind} ${c.id || ''}`).join(', '))}</span>
    <span class="disk-free"><button class="btn btn-xs" onclick="packsFetch(${jsArg(hub)}, ${jsArg(p.id)})">Fetch</button></span></div>`).join('') || '<div class="placeholder">Nothing published.</div>');
}
async function packsFetch(hub, pack) {
  try { const m = await apiFetch(`/api/packs/hubs/${encodeURIComponent(hub)}/fetch`, { method: 'POST', body: { pack } }); appAlert(`"${m.name}" is in your library: bring it in from there.`); }
  catch (e) { appAlert(e.message); }
  packsLibraryRender();
}

async function packsSend(id, hub) {
  try { const r = await apiFetch(`/api/packs/library/${encodeURIComponent(id)}/send`, { method: 'POST', body: { hub } }); appAlert(`Sent to ${r.to}: it waits in their library.`); }
  catch (e) { appAlert(e.message); }
}
function packsDelete(id) { appConfirm('Remove this pack from the library?', async () => { try { await apiFetch(`/api/packs/library/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); } packsLibraryRender(); }); }
async function packsHubAdd() {
  try { await apiFetch('/api/packs/hubs', { method: 'POST', body: { url: document.getElementById('pack-hub-url').value.trim(), token: document.getElementById('pack-hub-token').value.trim() } }); }
  catch (e) { appAlert(e.message); }
  packsLibraryRender();
}
function packsHubRemove(id) { appConfirm('Stop sending to this hub? (Revoke its token there too.)', async () => { try { await apiFetch(`/api/packs/hubs/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); } packsLibraryRender(); }); }

async function packsExport(keep = false) {
  const pick = kind => [...document.querySelectorAll(`#sp-packs input[data-pack="${kind}"]:checked`)].map(i => i.value);
  const body = { name: document.getElementById('pack-name').value.trim() || 'pack', skills: pick('skills'), specialists: pick('specialists'),
    recipes: pick('recipes'), mcp: pick('mcp'), memory: document.getElementById('pack-memory').checked, rules: document.getElementById('pack-rules').checked,
    edition: { branding: document.getElementById('pack-ed-branding').checked, look: document.getElementById('pack-ed-look').checked,
      face: document.getElementById('pack-ed-face').checked && (await faceSpec()), level: document.getElementById('pack-ed-level').value || null } };
  if (keep) {
    try { const m = await apiFetch('/api/packs/library', { method: 'POST', body }); appAlert(`Kept "${m.name}" in the library.`); } catch (e) { appAlert(e.message); }
    return packsLibraryRender();
  }
  const res = await fetch('/api/packs/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return appAlert((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'pack.dpack';
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function packsPlan(file, libId = null) {
  const out = document.getElementById('pack-plan');
  if (!file && !libId) return;
  _packFile = file; _packLib = libId;
  const form = new FormData(); if (file) form.append('file', file);
  const res = libId ? await fetch(`/api/packs/library/${encodeURIComponent(libId)}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    : await fetch('/api/packs/plan', { method: 'POST', body: form });
  out.scrollIntoView?.({ block: 'nearest' });
  const p = await res.json().catch(() => ({}));
  if (!res.ok) { out.innerHTML = `<div style="color:var(--red);font-size:12px">${escHtml(p.error || `HTTP ${res.status}`)}</div>`; return; }
  const rows = p.items.map(i => `<label class="disk-row" style="cursor:pointer"><span class="disk-label"><input type="checkbox" data-key="${escHtml(i.key)}" ${i.overwrites ? '' : 'checked'}>
      ${escHtml(i.kind)} · ${escHtml(i.id)}</span><span class="disk-path">${escHtml(i.command || i.path || '')}${i.steps ? ` · ${i.steps} steps` : ''}${i.count !== undefined ? ` · ${i.count}` : ''}${i.parts ? escHtml(i.parts) : ''}</span>
      <span class="disk-free" style="color:${i.overwrites ? 'var(--amber)' : 'var(--green)'}">${i.overwrites ? 'exists here' : 'new'}</span></label>`).join('');
  const needs = [...(p.needs.secrets || []).map(s => `fill in ${s}`), ...(p.needs.missingTools || []).map(t => `a tool this hive lacks: ${t}`), ...(p.needs.doca ? [p.needs.doca] : [])];
  out.innerHTML = `<div style="font-size:12px;margin-bottom:6px"><b>${escHtml(p.name || file?.name || 'pack')}</b>${p.native ? ' — another tool\'s files, read as they are' : ''}${p.description ? ` — ${escHtml(p.description)}` : ''}</div>
    ${rows || '<div class="placeholder">Nothing a pack carries.</div>'}
    ${needs.length ? `<div style="font-size:11px;color:var(--amber);margin-top:6px">Needs: ${needs.map(escHtml).join(' · ')}</div>` : ''}
    ${p.skipped.length ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">Skipped: ${p.skipped.map(s => `${escHtml(s.path)} (${escHtml(s.why)})`).join(', ')}</div>` : ''}
    ${rows ? `<div class="toolbar" style="gap:8px;margin-top:8px"><label style="font-size:12px"><input type="checkbox" id="pack-overwrite"> replace what exists</label>
      <button class="btn btn-sm btn-blue" onclick="packsImport()">Bring in the ticked ones</button></div>` : ''}`;
}

async function packsImport() {
  const only = [...document.querySelectorAll('#pack-plan input[data-key]:checked')].map(i => i.dataset.key);
  if (!only.length || (!_packFile && !_packLib)) return;
  const overwrite = document.getElementById('pack-overwrite').checked;
  const form = new FormData(); if (_packFile) { form.append('file', _packFile); form.append('only', JSON.stringify(only)); form.append('overwrite', String(overwrite)); }
  const res = _packLib ? await fetch(`/api/packs/library/${encodeURIComponent(_packLib)}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ only, overwrite }) })
    : await fetch('/api/packs/import', { method: 'POST', body: form });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) return appAlert(r.error || `HTTP ${res.status}`);
  appAlert(r.done.map(d => `${d.key}: ${d.ok ? `done${d.note ? ` (${d.note})` : ''}` : d.skipped ? `skipped — ${d.skipped}` : `failed — ${d.error}`}`).join('\n'));
  packsLoad();
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-packs' })));
