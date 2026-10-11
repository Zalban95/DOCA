/* Field → Models → llama.cpp → From Hugging Face (modules/llamacpp-hf): find a GGUF repository, see what it offers —
   each quantization with its size and whether it fits this machine — and install one: downloaded into the models
   folder (a split set whole, the vision projector when asked) and made a llama.cpp server with --jinja, off until
   started. The common choices are in front; context, GPU layers, port and name are folded under Advanced. */

let _lhfOffer = null;

/** The card, after the llama.cpp servers' own. Drawn once; its parts redraw themselves. */
function llamaHfCard() {
  if (document.getElementById('llamacpp-hf-card')) return;
  const after = document.getElementById('llamacpp-grid')?.closest('.card');
  if (!after) return;
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'llamacpp-hf-card' });
  card.innerHTML = `<div class="card-title">llama.cpp — From Hugging Face</div>
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px">Download a model from Hugging Face and run it as a llama.cpp server above.</p>
    <details class="desc page-about" style="margin:0 0 8px;font-size:11px"><summary>When to use this</summary>For models Ollama cannot run
      (their own chat template, files split in parts). The files (GGUF, the format llama.cpp reads) are downloaded, made a server above, and left off until you start it.</details>
    <div class="models-search-row">
      <input id="lhf-q" class="input" placeholder="Search GGUF models, or type org/repo" style="flex:1"
             onkeydown="if(event.key==='Enter') llamaHfGo()">
      <button class="btn btn-sm" onclick="llamaHfGo()">🔍 Find</button>${infoBtn('Words to search Hugging Face for models in the GGUF format, or a repository typed whole as owner/name to open it at once. Nothing is downloaded until you choose a size and press Download.')}
    </div>
    <div id="lhf-results" style="margin-top:6px"></div>
    <div id="lhf-offer" style="margin-top:6px"></div>
    <pre class="install-out" id="lhf-out" style="display:none;max-height:220px;margin-top:6px"></pre>`;
  after.after(card);
}

const _lhfGB = b => `${(b / 2 ** 30).toFixed(b >= 10 * 2 ** 30 ? 0 : 1)} GB`;

/** A repository typed whole opens at once; words search. */
async function llamaHfGo() {
  const q = document.getElementById('lhf-q').value.trim();
  if (!q) return;
  if (/^[\w.-]+\/[\w.-]+$/.test(q)) return llamaHfOpen(q);
  const box = document.getElementById('lhf-results');
  box.innerHTML = '<div class="placeholder pulse" style="padding:8px">Searching…</div>';
  try {
    const { results } = await apiFetch(`/api/models/llamacpp/hf/search?q=${encodeURIComponent(q)}`);
    box.innerHTML = results.length ? results.map(r => `<div class="disk-row" style="cursor:pointer" onclick="llamaHfOpen('${escHtml(r.id)}')">
        <span class="disk-label">${escHtml(r.id)}</span><span class="disk-free">↓ ${r.downloads.toLocaleString()} · ♥ ${r.likes}</span></div>`).join('')
      : '<div class="placeholder" style="padding:8px">No GGUF repositories match.</div>';
  } catch (e) { box.innerHTML = `<div class="status-line err">${escHtml(e.message)}</div>`; }
}

/** What one repository offers, with the common choices in front and the rest folded. */
async function llamaHfOpen(repo) {
  document.getElementById('lhf-results').innerHTML = '';
  const box = document.getElementById('lhf-offer');
  box.innerHTML = `<div class="placeholder pulse" style="padding:8px">Reading ${escHtml(repo)}…</div>`;
  try { _lhfOffer = await apiFetch(`/api/models/llamacpp/hf/files?repo=${encodeURIComponent(repo)}`); }
  catch (e) { box.innerHTML = `<div class="status-line err">${escHtml(e.message)}</div>`; return; }
  const o = _lhfOffer;
  // The largest that fits on one card; else the largest that runs at all; else the smallest — never a BF16 split over two
  // cards when a Q8 on one would do.
  const best = o.quants.filter(q => q.fit.one).pop() || o.quants.filter(q => q.fit.fits).pop() || o.quants[0];
  const fitCls = f => (f.fits ? 'badge-green' : f.fits === false ? 'badge-red' : 'badge-amber');
  box.innerHTML = `<div class="input-label" style="margin:4px 0">${escHtml(o.repo)}${o.architecture ? ` · ${escHtml(o.architecture)}` : ''}${o.context ? ` · ${o.context.toLocaleString()} tokens of context` : ''}${o.licence ? ` · ${escHtml(o.licence)}` : ''}</div>
    ${o.quants.length ? `<div class="input-label" style="margin:6px 0 2px">Size ${infoBtn('The same model packed smaller or larger (quantization: Q4 is small and a little less exact, Q8 large and close to the original). Each row says whether it fits this machine; the largest that fits on one graphics card is chosen for you.')}</div>` : ''}
    ${o.quants.length ? o.quants.map(q => `<label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 6px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px">
        <input type="radio" name="lhf-quant" aria-label="This size" value="${escHtml(q.quant || q.file)}" ${q === best ? 'checked' : ''}>
        <b style="min-width:90px">${escHtml(q.quant || q.file)}</b>
        <span style="color:var(--muted);min-width:110px">${_lhfGB(q.bytes)}${q.parts > 1 ? ` · ${q.parts} parts` : ''}</span>
        <span class="badge ${fitCls(q.fit)}" style="font-size:9px">${escHtml(q.fit.text)}</span></label>`).join('')
      : '<div class="placeholder" style="padding:8px">This repository has no GGUF files.</div>'}
    ${o.mmproj ? `<label style="display:block;font-size:12px;margin-top:6px"><input type="checkbox" id="lhf-vision" checked> Also read pictures (its vision projector, ${_lhfGB(o.mmproj.bytes)})</label>${infoBtn('Downloads the extra file that lets this model look at pictures, and starts the server with it. Untick to save the space and memory if you only want text. On by default.')}` : ''}
    ${advancedFold(`<div class="llamacpp-controls" style="margin-top:6px">
        <label class="services-ctrl-label">Name ${infoBtn('What the server is called in the list above. Empty: the repository name and the size chosen.')}</label><input class="input" id="lhf-name" data-default="" data-label="Name" placeholder="from the repository" style="width:180px">
        <label class="services-ctrl-label">Context size ${infoBtn('How many tokens (pieces of words) the model can hold at once. Empty: the model\'s own, lowered to what fits the memory beside it.')}</label><input class="input" id="lhf-ctx" data-default="" data-label="Context size" type="number" min="512" step="512" placeholder="estimated" style="width:110px">
        <label class="services-ctrl-label">GPU layers ${infoBtn('How much of the model goes on the graphics card: a number of layers, or auto. Empty: all of them when the model fits on the card, else auto, where llama.cpp places them itself.')}</label><input class="input" id="lhf-ngl" data-default="" data-label="GPU layers" placeholder="estimated" style="width:110px">
        <label class="services-ctrl-label">Port ${infoBtn('The number the new server listens on. Empty: the first free one from 11435.')}</label><input class="input" id="lhf-port" data-default="" data-label="Port" type="number" min="1024" max="65535" placeholder="next free" style="width:100px">
      </div>
      <p style="font-size:11px;color:var(--muted);margin:4px 0 0">Files go to <code>${escHtml(o.folder)}</code> (setting <code>llamacpp.modelsDir</code>). The server always uses the model's own chat template (--jinja).</p>`, { id: 'llamacpp-hf', label: 'Advanced — name, context, GPU layers, port' })}
    ${o.llamaServer ? '' : '<p style="font-size:11px;margin-top:6px" class="status-line err">llama-server is not installed here: it downloads now and starts once it is (Settings → System → System tools).</p>'}
    <div class="toolbar" style="margin-top:8px"><button class="btn btn-sm btn-teal" id="lhf-go" onclick="llamaHfInstall()" ${o.quants.length ? '' : 'disabled'}>⬇ Download and make a server</button></div>`;
}

async function llamaHfInstall() {
  const o = _lhfOffer;
  const pick = document.querySelector('input[name="lhf-quant"]:checked')?.value;
  if (!o || !pick) return;
  const val = id => document.getElementById(id)?.value.trim() || '';
  const body = { id: `${o.repo}:${pick}`, vision: document.getElementById('lhf-vision') ? document.getElementById('lhf-vision').checked : false,
    ...(val('lhf-name') ? { name: val('lhf-name') } : {}), ...(val('lhf-ctx') ? { ctxSize: val('lhf-ctx') } : {}),
    ...(val('lhf-ngl') ? { nGpuLayers: val('lhf-ngl') } : {}), ...(val('lhf-port') ? { port: val('lhf-port') } : {}) };
  const out = document.getElementById('lhf-out'), btn = document.getElementById('lhf-go');
  out.style.display = 'block'; out.textContent = '';
  btn.disabled = true;
  await sseStream('/api/models/llamacpp/hf/install', body, {
    onStatus: t => appendStream(out, t),
    onError: e => appendStream(out, `\nError: ${e.message}`),
  });
  btn.disabled = false;
  llamaLoadList();
}
