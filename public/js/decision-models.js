/* Field → Models → Decision models (modules/system-one; docs/experiments/system-one.md): the System 1 kind — models that
   write no text and answer a typed question about a request or a page with probabilities. Two providers, as for the
   other model types: Laya, open and run on this hub (set up, start, stop, its state), and TypeSafe's Jev, an API used
   with a key for services. How sure one must be, and a test. Whether DOCA uses it is the experiment systemOne
   (Settings → Developer). */
async function decisionModelsTab() {
  let card = document.getElementById('dm-card');
  if (!card) {
    card = Object.assign(document.createElement('div'), { className: 'card', id: 'dm-card' });
    document.getElementById('tab-models')?.append(card);
  }
  return _dmLoad();
}

async function _dmLoad() {
  const card = document.getElementById('dm-card');
  if (!card) return;
  let v;
  try { v = await apiFetch('/api/system-one'); }
  catch (e) { card.innerHTML = `<div class="card-title">Decision models</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const s = v.settings, svc = v.service, job = svc.setup, j = v.jev;
  const busy = job?.state === 'running', running = svc.state === 'running';
  const use = id => `<input type="radio" name="dm-provider" value="${id}" ${s.provider === id ? 'checked' : ''} onchange="decisionModelsSave({provider:this.value})">`;
  const tick = (ok, label) => `<span class="ww-tick ${ok ? 'ok' : ''}">${ok ? '✓' : '·'} ${label}</span>`;
  card.innerHTML = `<div class="card-title">Decision models — System 1</div>
    <p class="ww-note">Models that write no text: given a request or a page and a typed question, they answer with probabilities in a few
      milliseconds. DOCA asks one for bounded decisions — how big a request is, whether a call answers now or hands the work on, which element of
      an agent's page to use next — and decides as before whenever it is less sure than the threshold.
      ${v.on ? '<b>In use</b> (experiment systemOne is on).' : 'Not in use until the experiment systemOne is on (Settings → Developer); set up and test here meanwhile.'}</p>
    <div class="dm-provider"><label>${use('laya')} <b>Laya</b> — open (Apache 2.0), runs on this hub</label>
      <div class="ww-row">${tick(svc.ready, 'set up')}${tick(running, svc.state)}
        <span class="ww-dir">127.0.0.1:${svc.port}${svc.computesOn ? ` · on ${escHtml(svc.computesOn)}` : ''} · ${escHtml(svc.package)} · <select class="input" style="width:auto" onchange="decisionModelsSave({checkpoint:this.value})">
          ${[['english', 'English (ModernBERT-large, 421M)'], ['multilingual', '100+ languages (mmBERT-base, 322M)']].map(([k, l]) => `<option value="${k}" ${s.checkpoint === k ? 'selected' : ''}>${l}</option>`).join('')}</select></span></div>
      <div class="ww-row">
        <button class="btn btn-sm" ${busy ? 'disabled' : ''} onclick="decisionModelsDo('setup')">${svc.ready ? 'Install again' : 'Install (PyTorch and Laya, 1–6 GB)'}</button>
        ${busy ? '<button class="btn btn-sm btn-red" onclick="decisionModelsDo(\'setup/stop\')">■ Stop</button>' : ''}
        <button class="btn btn-sm btn-blue" ${!svc.ready || running || svc.state === 'starting' ? 'disabled' : ''} onclick="decisionModelsDo('start')">▶ Start</button>
        <button class="btn btn-sm" ${running ? '' : 'disabled'} onclick="decisionModelsDo('stop')">■ Stop</button>
        <label class="ww-dim"><input type="checkbox" ${svc.autostart ? 'checked' : ''} onchange="decisionModelsSave({autostart:this.checked})"> start with DOCA</label></div>
      ${svc.error ? `<div class="ww-dim">${escHtml(svc.error)}</div>` : ''}
      ${job || svc.log.length ? `<div class="ww-job ${job?.state || ''}">${job ? `Install: ${escHtml(job.state)} — ${escHtml(job.stage || '')}${job.error ? ` · ${escHtml(job.error)}` : ''}` : 'Service'}
        <pre>${escHtml([...(job?.log || []).slice(-6), ...svc.log.slice(-6)].join('\n'))}</pre></div>` : ''}</div>
    <div class="dm-provider"><label>${use('jev')} <b>TypeSafe Jev</b> — closed, an API (early access)</label>
      <div class="ww-row">${tick(j.present, j.present ? `key "${escHtml(j.key)}"${j.right ? '' : ` — at ${escHtml(j.origin || '?')}, not api.typesafe.ai`}` : `no key "${escHtml(j.key)}" yet`)}
        <span class="ww-dir">add it in Field → Connectors → Keys for services, at https://api.typesafe.ai</span></div></div>
    <div class="ww-row"><label>Threshold <input class="input" type="number" min="0" max="1" step="0.05" value="${escHtml(String(s.threshold))}" style="width:80px"
      onchange="decisionModelsSave({threshold:this.value})"></label><span class="ww-dim">the probability its top choice must reach to be used</span></div>
    <div class="ww-row"><input class="input" id="dm-test" placeholder="Test with a request, e.g. build me a website for my bakery" style="flex:1;min-width:200px">
      <button class="btn btn-sm" onclick="decisionModelsTest()">Test</button></div>
    <div id="dm-test-out" class="ww-dim" style="white-space:pre-wrap"></div>`;
  if (busy || svc.state === 'starting') setTimeout(() => { if (document.getElementById('dm-card') === card && currentTab === 'models') _dmLoad(); }, 3000);
}

async function decisionModelsSave(body) {
  try { await apiFetch('/api/system-one/settings', { method: 'POST', body }); } catch (e) { appAlert(e.message); }
  _dmLoad();
}

async function decisionModelsDo(what) {
  const call = apiFetch(`/api/system-one/${what}`, { method: 'POST' }).catch(e => appAlert(e.message));
  setTimeout(_dmLoad, 400);   // "starting" while the weights load
  await call;
  _dmLoad();
}

async function decisionModelsTest() {
  const out = document.getElementById('dm-test-out'), text = document.getElementById('dm-test').value.trim();
  if (!text) { out.textContent = 'Write a request first.'; return; }
  out.textContent = 'Asking…';
  try {
    const r = await apiFetch('/api/system-one/test', { method: 'POST', body: { text } });
    const line = (label, a) => `${label}: ${a.choice} (${Object.entries(a.probabilities).map(([k, p]) => `${k} ${Math.round(p * 100)}%`).join(', ')})${a.sure ? '' : ' — under the threshold: today\'s way decides'}`;
    out.textContent = `${r.provider} · ${r.model} · ${r.ms} ms\n${line('Size', r.answers.size)}\n${line('Pace (A quick, B normal)', r.answers.pace)}\n${line('In a call (now, or hand it on)', r.answers.route)}`;
  } catch (e) { out.textContent = e.message; }
}
