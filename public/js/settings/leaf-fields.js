/* Boxes for declared settings, drawn by name (modules/settings-leaves.js): a page lists the dotted paths it owns and
   gets a box for each with its hint and default, folded under Advanced, and one Save. Deep test B found the agents'
   computers' limits, the MCP timeouts, the adaptive step ceiling, the feature index's thresholds and the update source
   with no control anywhere. Saved through POST /api/prefs, so a guarded switch still asks for the password. */

/** The box's place: `#id`, made after `#afterId` the first time (index.html is at its line ceiling). */
function leafFieldsSlot(afterId, id) {
  let el = document.getElementById(id);
  if (!el) { el = Object.assign(document.createElement('div'), { id }); document.getElementById(afterId)?.after(el); }
  return el;
}

/** Draw the boxes for `paths` into `el`, folded as `label` (id for remembering the fold). */
async function leafFieldsDraw(el, paths, { label = 'Advanced', id = '' } = {}) {
  if (!el) return;
  let leaves = [];
  try { leaves = (await apiFetch(`/api/settings/leaves?paths=${encodeURIComponent(paths.join(','))}`)).leaves || []; }
  catch { el.innerHTML = ''; return; }   // not this person's to change (host): no boxes, rather than an error on their page
  if (!leaves.length) { el.innerHTML = ''; return; }
  const box = l => {
    const name = l.path.split('.').pop().replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).replace(/ Ms$/, ' (ms)');
    // A folder or a file on this machine is chosen from a tree too (fp.js); the box stays typeable.
    const pick = l.type === 'string' && !l.oneOf && (/(^|\.)(dir|[a-z]+Dir|folder|[a-z]+Folder)$/.test(l.path) || l.path === 'scout.repo') ? ' data-path-pick="dir"' : '';
    const common = `${pick} data-leaf="${escHtml(l.path)}" data-type="${escHtml(l.type)}" data-default="${escHtml(String(l.default ?? ''))}" data-label="${escHtml(name)}"`;
    const input = l.oneOf ? `<select class="input" ${common}>${l.oneOf.map(o => `<option${o === l.value ? ' selected' : ''}>${escHtml(o)}</option>`).join('')}</select>`
      : l.type === 'boolean' ? `<input type="checkbox" ${common}${l.value ? ' checked' : ''}>`
      : `<input class="input" ${common} ${['number', 'integer'].includes(l.type) ? `type="number"${l.min != null ? ` min="${l.min}"` : ''}${l.max != null ? ` max="${l.max}"` : ''}${l.type === 'integer' ? ' step="1"' : ''}` : 'type="text"'} value="${escHtml(String(l.value ?? ''))}" style="width:${['number', 'integer'].includes(l.type) ? '120px' : '260px'}">`;
    return `<div class="field" title="${escHtml(l.path)}"><div class="input-label">${escHtml(name)}</div>${input}
      <div class="input-label" style="text-transform:none;letter-spacing:0;max-width:360px">${escHtml(l.hint)} <span style="opacity:.7">(default ${escHtml(JSON.stringify(l.default))})</span></div></div>`;
  };
  el.innerHTML = advancedFold(`<div class="row form-row" style="flex-wrap:wrap;gap:12px;align-items:flex-start">${leaves.map(box).join('')}</div>
    <div class="toolbar" style="gap:8px;margin-top:6px"><button class="btn btn-sm btn-blue" onclick="leafFieldsSave(this)">Save</button><span class="status-line"></span></div>`, { label, id });
}

/** Save every box in the fold the button sits in: each top-level section merged over what the file holds. */
async function leafFieldsSave(btn) {
  const fold = btn.closest('.adv-fold') || btn.parentElement;
  const st = btn.parentElement.querySelector('.status-line');
  const changes = [];
  for (const f of fold.querySelectorAll('[data-leaf]')) {
    const type = f.dataset.type;
    let v = f.type === 'checkbox' ? f.checked : f.value.trim();
    if (['number', 'integer'].includes(type)) {
      if (v === '') continue;   // left empty: the default stays
      v = Number(v);
      if (!Number.isFinite(v) || (type === 'integer' && !Number.isInteger(v))) return askFor(f, `${f.dataset.label} is a ${type === 'integer' ? 'whole ' : ''}number.`);
      if (f.min !== '' && v < Number(f.min)) return askFor(f, `${f.dataset.label} is at least ${f.min}.`);
      if (f.max !== '' && v > Number(f.max)) return askFor(f, `${f.dataset.label} is at most ${f.max}.`);
    }
    changes.push([f.dataset.leaf, v]);
  }
  try {
    const prefs = await apiFetch('/api/prefs');
    const body = {};
    for (const [path, v] of changes) {
      const [top, ...rest] = path.split('.');
      body[top] ||= JSON.parse(JSON.stringify(prefs[top] || {}));
      let o = body[top];
      for (const k of rest.slice(0, -1)) o = (o[k] ||= {});
      o[rest.at(-1)] = v;
    }
    await apiFetch('/api/prefs', { method: 'POST', body });
    setStatus(st, '✓ Saved', 'ok');
    if (typeof advancedFoldRefresh === 'function') advancedFoldRefresh(fold.closest('.card') || fold);
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}
