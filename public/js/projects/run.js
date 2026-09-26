/* ═══════════════════════════════════════════════════════
   Projects → Build & test: the project's commands (read from its files:
   Gradle for Android, npm scripts, cargo, go, make…), what each needs and
   whether it is installed, a ▶ per command, and its output as it runs. The
   same `project run` the agent calls; a run is a background job, so closing
   the tab does not stop a build.
   ═══════════════════════════════════════════════════════ */

const PJR = { job: null, timer: null };
const _pjp = p => `/api/projects/${encodeURIComponent(PJ.project.project.id)}${p}`;

function pjRunRender(body) {
  const d = PJ.project;
  body.innerHTML = '';
  if (!d.commands.length) {
    body.innerHTML = '<div class="placeholder">No build system recognised in this folder. Add a command below, or ask the agent how it builds.</div>';
  }
  for (const c of d.commands) {
    const row = document.createElement('div');
    row.className = 'pj-cmd';
    row.title = c.run;
    const go = Object.assign(document.createElement('button'), { className: 'btn btn-xs btn-green', textContent: '▶', title: `Run: ${c.run}` });
    go.disabled = c.missing.length > 0;
    go.onclick = () => pjRunCommand(c.name);
    row.append(go, Object.assign(document.createElement('span'), { className: 'pj-cmd-name', textContent: c.name }),
      Object.assign(document.createElement('span'), { className: 'pj-meta', textContent: c.missing.length ? `needs ${c.missing.join(', ')}` : c.what || c.run }));
    body.appendChild(row);
  }
  const tc = Object.entries(d.toolchains || {});
  if (tc.length) {
    body.appendChild(Object.assign(document.createElement('div'), { className: 'pj-res-file', textContent: 'Toolchains' }));
    for (const [name, t] of tc) {
      body.appendChild(Object.assign(document.createElement('div'), { className: `pj-tc ${t.detected ? 'ok' : 'missing'}`,
        textContent: `${t.detected ? '✓' : '✗'} ${name}${t.version ? ` — ${t.version}` : t.path ? ` — ${t.path}` : t.detected ? '' : ' — not found'}` }));
    }
    if (d.kinds.some(k => k.kind === 'android') && !d.toolchains['android-sdk']?.detected)
      body.appendChild(Object.assign(document.createElement('div'), { className: 'pj-meta', textContent:
        'No Android SDK found. Install Android Studio (or the command-line tools) and set ANDROID_HOME; DOCA also looks in ~/Android/Sdk.' }));
  }
  const add = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: '+ Add a command' });
  add.onclick = pjRunAdd;
  body.appendChild(add);
  pjLspSection(body);   // which language servers are here (projects/lsp.js)
}

async function pjRunCommand(name) {
  let r;
  try { r = await apiFetch(_pjp('/run'), { method: 'POST', body: { command: name } }); }
  catch (e) { return appAlert(e.message); }
  PJR.job = r.job;
  _pjOutput(`$ ${r.command.run}\n`, true);
  clearTimeout(PJR.timer);
  const poll = async () => {
    let j;
    try { j = await apiFetch(`${_pjp(`/jobs/${r.job.id}`)}?bytes=200000`); } catch { return; }
    _pjOutput(`$ ${r.command.run}\n${j.output}`, j.job.state === 'running', j.job);
    if (j.job.state === 'running') PJR.timer = setTimeout(poll, 1000);
    else { pjRefresh(); if (PJ.view === 'git') pjView('git'); }
  };
  poll();
}

/** The output pane under the editor: shown while a command runs and after. */
function _pjOutput(text, running, job) {
  let pane = document.getElementById('pj-output');
  if (!pane) {
    pane = document.createElement('div');
    pane.id = 'pj-output';
    pane.className = 'pj-output';
    pane.innerHTML = '<div class="pj-output-head"><span id="pj-output-title"></span><span class="pj-spacer"></span>'
      + '<button class="btn btn-xs" id="pj-output-stop" onclick="pjRunStop()">■ Stop</button>'
      + '<button class="btn btn-xs" onclick="document.getElementById(\'pj-output\').remove()">×</button></div><pre id="pj-output-text"></pre>';
    document.querySelector('#tab-projects .pj-main').appendChild(pane);
  }
  document.getElementById('pj-output-title').textContent = running ? 'Running…'
    : `${job?.state === 'exited' ? (job.code === 0 ? '✓ Done' : `✗ Exit ${job.code}`) : job?.state || ''}`;
  document.getElementById('pj-output-stop').style.display = running ? '' : 'none';
  const pre = document.getElementById('pj-output-text');
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  pre.textContent = text;
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}

async function pjRunStop() {
  if (!PJR.job) return;
  try { await apiFetch(_pjp(`/jobs/${PJR.job.id}/stop`), { method: 'POST' }); } catch {}
}

function pjRunAdd() {
  appPrompt('A command for this project, as "name: command line" (e.g. deploy: ./deploy.sh):', async v => {
    const m = /^\s*([\w:-]{1,40})\s*:\s*(.+)$/.exec(v);
    if (!m) return appAlert('Write it as name: command line.');
    try {
      await apiFetch(_pjp(''), { method: 'POST', body: { commands: { ...(PJ.project.project.commands || {}), [m[1]]: m[2] } } });
      await pjRefresh();
      pjView('run');
    } catch (e) { appAlert(e.message); }
  });
}
