/* A llama.cpp router's models, set from the panel (modules/llamacpp-router; asked 2026-10-12): each model of its preset
   file with the settings a person changes — the model file, its vision projector, the context, sleep — and the rest
   folded under Advanced. Save writes the file (the old one kept beside it), the router reads it again, and the model
   loads with the new settings at its next request. Drawn under the llama.cpp servers, only where a router is found. */
const LLAMA_ROUTER_COMMON = ['model', 'mmproj', 'ctx-size', 'sleep-idle-seconds', 'load-on-startup'];

async function llamaRouterCard() {
  const grid = document.getElementById('llamacpp-grid');
  if (!grid) return;
  let box = document.getElementById('llamacpp-router');
  if (!box) { box = document.createElement('div'); box.id = 'llamacpp-router'; (document.getElementById('llamacpp-external') || grid).after(box); }
  let d;
  try { d = await apiFetch('/api/models/llamacpp/router'); } catch { box.innerHTML = ''; return; }
  if (!d.file || !d.sections) { box.innerHTML = d.file || d.router ? `<p class="desc" style="margin:10px 2px">${escHtml(d.why || '')}</p>` : ''; return; }
  const state = id => d.router?.models?.find(m => m.id === id)?.state;
  const field = (sec, k) => {
    const meta = d.keys[k], v = sec.values[k] ?? '', id = `lr-${_lrId(sec.name)}-${k}`;
    const browse = k === 'model' || k === 'mmproj' ? ` <button class="btn btn-xs" title="Browse" onclick="fpOpen('${id}','file')">📁</button>` : '';
    const unset = sec.name === '*' ? 'as llama.cpp decides' : 'as for every model';
    // A setting with fixed choices is a list (empty: not set here), never a box to type true or q8_0 into.
    const input = meta.choices
      ? `<select class="input" id="${id}" data-key="${escHtml(k)}" style="flex:1;min-width:0;font-size:11px"><option value="">${unset}</option>${meta.choices.map(c => `<option value="${escHtml(c)}"${c === v ? ' selected' : ''}>${escHtml(c)}</option>`).join('')}</select>`
      : `<input class="input" id="${id}" data-key="${escHtml(k)}" value="${escHtml(v)}" style="flex:1;min-width:0;font-size:11px" placeholder="${unset}">`;
    return `<label class="services-ctrl-label">${escHtml(meta.label)} ${infoBtn(meta.hint)}</label>
      <div style="display:flex;gap:4px;align-items:center;flex:1;min-width:160px">${input}${browse}</div>`;
  };
  const card = sec => {
    const keys = Object.keys(d.keys).filter(k => sec.name !== '*' || (k !== 'model' && k !== 'mmproj'));
    const common = keys.filter(k => LLAMA_ROUTER_COMMON.includes(k)), more = keys.filter(k => !LLAMA_ROUTER_COMMON.includes(k));
    const st = state(sec.name);
    return `<div class="card" style="margin-top:10px" id="lr-card-${_lrId(sec.name)}">
      <div class="card-title">${sec.name === '*' ? 'Every model of the router' : escHtml(sec.name)}${st ? ` <span class="desc" style="font-size:11px">— ${escHtml(st)}</span>` : ''}</div>
      <div class="llamacpp-controls">${common.map(k => field(sec, k)).join('')}</div>
      ${advancedFold(`<div class="llamacpp-controls">${more.map(k => field(sec, k)).join('')}</div>`, { id: 'llamacpp-router', label: 'Advanced — cache, cards, spilling to RAM, requests' })}
      ${sec.others.length ? `<p class="desc" style="font-size:11px">Also in the file, kept as they are: ${sec.others.map(escHtml).join(', ')}.</p>` : ''}
      <div class="llamacpp-actions"><button class="btn btn-sm btn-blue" onclick="llamaRouterSave('${escHtml(sec.name)}')">💾 Save</button><span class="desc" id="lr-said-${_lrId(sec.name)}" style="font-size:11px"></span></div>
    </div>`;
  };
  box.innerHTML = `<div class="input-label" style="margin:16px 0 4px">The llama.cpp router's models ${infoBtn(`The router at ${d.router?.url || 'this machine'} serves the models of its preset file, ${d.file}. Change one here; Save keeps the old file beside it and the model loads with the new settings at its next request.`)}</div>
    ${d.sections.map(card).join('')}`;
}

const _lrId = name => String(name).replace(/[^A-Za-z0-9_-]/g, '_');

async function llamaRouterSave(section) {
  const card = document.getElementById(`lr-card-${_lrId(section)}`), said = document.getElementById(`lr-said-${_lrId(section)}`);
  const values = Object.fromEntries([...card.querySelectorAll('[data-key]')].map(i => [i.dataset.key, i.value.trim()]));
  said.textContent = 'Saving…';
  try {
    const r = await apiFetch('/api/models/llamacpp/router', { method: 'POST', body: { section, values } });
    said.textContent = r.changed ? `Saved. ${(r.said || []).join(' ')}` : 'Nothing changed.';
  } catch (e) { said.textContent = e.message; }
}
