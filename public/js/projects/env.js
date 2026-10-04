/* ═══════════════════════════════════════════════════════
   Projects → Build & test → Environment (modules/projects/env.js): what the
   machine has, what the project has of its own (a venv, node_modules), and
   which Python its commands run with — a choice per project, with buttons to
   make a venv and install into it.
   ═══════════════════════════════════════════════════════ */

async function pjEnvSection(body) {
  const box = document.createElement('div');
  box.className = 'pj-env';
  box.innerHTML = '<div class="pj-res-file">Environment</div><div class="placeholder pulse">Looking…</div>';
  body.prepend(box);
  let v;
  try { v = await apiFetch(_pjp('/env')); } catch (e) { box.lastChild.textContent = e.message; return; }
  if (!box.isConnected) return;   // the view changed while asking
  box.lastChild.remove();
  const el = (tag, props = {}, style = '') => Object.assign(document.createElement(tag), props, style ? { style: style } : {});
  const line = (ok, text, title = '') => el('div', { className: `pj-tc ${ok ? 'ok' : 'missing'}`, textContent: `${ok ? '✓' : '✗'} ${text}`, title });

  box.appendChild(el('div', { className: 'pj-meta', textContent: 'On this machine' }));
  for (const r of v.runtimes) if (r.detected || ['python', 'node'].includes(r.id))
    box.appendChild(line(r.detected, `${r.label}${r.version ? ` — ${r.version}` : ' — not found'}`, r.path || ''));

  const py = v.runtimes.find(r => r.id === 'python');
  const python = el('div', { className: 'pj-env-py' }, 'margin:6px 0');
  python.appendChild(el('div', { className: 'pj-meta', textContent: 'Python for this project' }));
  const sel = el('select', { className: 'input' }, 'width:100%');
  sel.appendChild(new Option(`Machine${py?.version ? ` — ${py.version}` : ''}`, 'machine'));
  for (const venv of v.local.venvs) sel.appendChild(new Option(`Project venv ${venv.dir}${venv.version ? ` — ${venv.version}` : ''}${venv.python ? '' : ' (broken: no python inside)'}`, venv.dir));
  sel.value = v.chosen.kind === 'venv' ? v.chosen.dir : 'machine';
  sel.onchange = async () => {
    try { await apiFetch(_pjp('/env'), { method: 'POST', body: { python: sel.value } }); setStatus(document.getElementById('pj-status'), `✓ Python: ${sel.selectedOptions[0].text}`, 'ok'); }
    catch (e) { appAlert(e.message); }
  };
  python.appendChild(sel);
  python.appendChild(el('div', { className: 'pj-meta', style: 'white-space:normal', textContent: v.chosen.kind === 'venv'
    ? 'The project\'s commands run with this venv first on PATH, and the agent is told to use it.'
    : v.local.venvs.length ? 'The project has a venv but runs with the machine\'s Python.' : 'Packages installed for this project go into the machine\'s Python. A venv keeps them to the project.' }));
  box.appendChild(python);

  const actions = el('div', {}, 'display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 10px');
  const btn = (text, title, fn) => actions.appendChild(el('button', { className: 'btn btn-xs', textContent: text, title, onclick: fn }));
  if (py?.detected) btn('+ Create venv', 'python -m venv .venv in the project, then use it', () => pjEnvSetup('venv'));
  if (v.local.files.includes('requirements.txt') || v.local.files.includes('pyproject.toml'))
    btn(`⬇ pip install${v.chosen.kind === 'venv' ? ` (into ${v.chosen.dir})` : ' (machine)'}`, 'Install the project\'s Python dependencies', () => pjEnvSetup('pip'));
  if (v.local.files.includes('package.json'))
    btn(v.local.nodeModules ? '⟳ npm install' : '⬇ npm install', 'Install the project\'s Node dependencies into node_modules', () => pjEnvSetup('npm'));
  if (actions.childElementCount) box.appendChild(actions);
  if (v.local.files.length) box.appendChild(el('div', { className: 'pj-meta', textContent: `Project files: ${v.local.files.join(', ')}${v.local.nodeModules ? ', node_modules' : ''}` }));
}

async function pjEnvSetup(action) {
  const go = async dir => {
    let r;
    try { r = await apiFetch(_pjp('/env/setup'), { method: 'POST', body: { action, ...(dir ? { dir } : {}) } }); }
    catch (e) { return appAlert(e.message); }
    pjFollowJob(r.job, r.command.run, async job => {
      if (job.code === 0 && r.then) await apiFetch(_pjp('/env'), { method: 'POST', body: r.then }).catch(() => {});
      await pjRefresh();
      if (PJ.view === 'run') pjView('run');
    });
  };
  if (action === 'venv') appPrompt('Folder for the venv, in the project:', dir => go(dir || '.venv'), '.venv');
  else go();
}
