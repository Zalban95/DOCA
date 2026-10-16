/* Settings → Harnesses → OpenDots and → CLI harnesses (settings/subnav.js draws the section). Each harness's settings
   are its own: OpenDots' folder and address and its Compose project (modules/harness/opendots.js), and each CLI
   harness's launch command, model, config file and environment — the same fields as its ⚙ on Controls, saved through
   the same route. */

async function openDotsSettingsLoad() {
  const panel = document.getElementById('sp-opendots');
  if (!panel) return;
  let s;
  try { s = await apiFetch('/api/harness/opendots/state'); } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const color = s.state === 'ready' ? 'var(--green)' : s.state === 'absent' ? 'var(--muted)' : 'var(--amber)';
  panel.innerHTML = `<div class="card">
    <div class="card-title">OpenDots</div>
    <details class="desc page-about" style="font-size:11px;color:var(--muted);margin-bottom:10px"><summary>What this is</summary>CopilotKit's Dots, Spaces and pages, in its own web app with its own data and keys —
      a separate program beside this hub, never a part of it. Its keys go in its own <code>.env</code>; this hub does not fill them.</details>
    <p style="font-size:12px;color:${color};margin-bottom:10px">${escHtml(s.say)}</p>
    <div class="harness-cfg-grid">
      <label>Folder${infoBtn('Where OpenDots is installed on this machine: its code, its .env with its keys, and its Compose project. Default: ~/opendots.')}</label><div><input class="input" id="od-dir" value="${escHtml(s.dir)}" style="width:100%"></div>
      <label>Address${infoBtn('Where its web app answers, opened by ▶ Open and checked to say whether it is running. Default: http://127.0.0.1:4310.')}</label><div><input class="input" id="od-url" value="${escHtml(s.url)}" placeholder="http://127.0.0.1:4310" style="width:100%"></div>
    </div>
    <div class="toolbar" style="gap:6px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-sm btn-blue" onclick="openDotsSave()">Save</button>
      <button class="btn btn-sm btn-green" onclick="window.open(document.getElementById('od-url').value, '_blank', 'noopener')">▶ Open</button>
      <button class="btn btn-sm" onclick="openDotsStack('start')">▶ Start</button>
      <button class="btn btn-sm" onclick="openDotsStack('stop')">■ Stop</button>
    </div>
    <pre id="od-out" class="terminal" style="display:none;margin-top:8px;max-height:min(45vh,320px)"></pre>
  </div>`;
}

async function openDotsSave() {
  try { await apiFetch('/api/harness/opendots/config', { method: 'POST', body: { dir: document.getElementById('od-dir').value, url: document.getElementById('od-url').value } }); }
  catch (e) { return appAlert(e.message); }
  openDotsSettingsLoad();
}

async function openDotsStack(action) {
  const out = document.getElementById('od-out');
  showStream(out, '');
  await sseStream('/api/harness/opendots/stack', { action }, { onStatus: t => appendStream(out, t), onError: e => appendStream(out, `\nError: ${e.message}`) });
  const keep = out.textContent;
  await openDotsSettingsLoad();
  const o = document.getElementById('od-out'); if (o) { o.style.display = 'block'; o.textContent = keep; }
}

/* Each outside harness's switch on a team (prefs teams.outside.use, harness-teams/harnesses.js mode; asked 2026-10-16).
   Moving one to "On its own" asks for the password (auth/guarded.js); the panel's fetch asks and sends again. */
// A function, not a list: the product's name (BRAND, from /api/branding) arrives after this file is read.
const harnessTeamUse = () => [
  ['never', 'Never', `Not offered and not run: teams use ${(typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA'}'s own agents.`],
  ['ask', 'Ask me first', 'Used when you name it, or say yes when the Orchestrator offers it.'],
  ['free', 'On its own', 'The Orchestrator starts it itself when a task fits — in agents\' computers only — and tells you it did.'],
];

function harnessTeamUseHtml(h) {
  if (!h.teamUse) return '';
  const id = escHtml(h.id), hint = (harnessTeamUse().find(x => x[0] === h.teamUse) || [])[2] || '';
  return `<label>On a team${infoBtn('Whether a team may use it, in an agents\' computer of its own: Never; Ask me first — when you name it or say yes to the Orchestrator\'s offer; On its own — the Orchestrator starts it when a task fits, and says so. On its own asks for your password.')}</label>
    <div><select class="input" id="sh-team-${id}" onchange="harnessTeamUseSave(${jsArg(h.id)}, this.value)">${harnessTeamUse().map(([v, w]) => `<option value="${v}"${v === h.teamUse ? ' selected' : ''}>${w}</option>`).join('')}</select>
      <div class="desc" id="sh-team-hint-${id}" style="font-size:11px;color:var(--muted);margin-top:3px">${escHtml(hint)}</div></div>`;
}

async function harnessTeamUseSave(id, value) {
  const hint = document.getElementById(`sh-team-hint-${id}`);
  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { teams: { outside: { use: { [id]: value } } } } });
    if (hint) hint.textContent = (harnessTeamUse().find(x => x[0] === value) || [])[2] || '';
  } catch (e) { if (hint) hint.textContent = e.message; otherHarnessesLoad(); }
}

async function otherHarnessesLoad(only) {
  const panel = document.getElementById('sp-harness-others');
  if (!panel) return;
  let list = [], all = [];
  try { all = (await apiFetch('/api/harness')).harnesses; list = all.filter(h => (h.kind === 'cli' || h.kind === 'custom') && h.detected && (!only || h.id === only)); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  // Harnesses a team can use that are not installed here (they are installed in agents' computers): their switches in one card.
  const away = all.filter(h => h.teamUse && !h.detected);
  const teamCard = away.length ? `<div class="card"><div class="card-title">On a team</div>
    <p class="desc" style="font-size:11px;color:var(--muted);margin-bottom:8px">Outside harnesses a team can run in agents' computers, though not installed on this machine.</p>
    <div class="harness-cfg-grid">${away.map(h => harnessTeamUseHtml(h).replace('<label>On a team', `<label>${escHtml(h.label)}`)).join('')}</div></div>` : '';
  panel.innerHTML = teamCard + list.map(h => {
    const c = h.config || {}, id = escHtml(h.id);
    return `<div class="card">
      <div class="card-title" style="display:flex;gap:8px;align-items:center">${escHtml(h.label)} <span class="tool-version">${escHtml(h.version || '')}</span>
        <span style="font-size:10px;color:var(--muted);text-transform:none;letter-spacing:0">${escHtml(h.vendor || '')}${h.oneShot ? ' · answers the floating chat one question at a time' : ''}</span></div>
      <div class="harness-cfg-grid">
        <label>Launch command${infoBtn(`The command typed into its terminal to start it. Default: ${h.cmd || 'its own command'}.`)}</label><div><input class="input" id="sh-launch-${id}" value="${escHtml(c.launchCmd || h.cmd || '')}" style="width:100%"></div>
        <label>Model${infoBtn('A model name passed to it as --model when it starts. Empty: its own default model.')}</label><div><input class="input" id="sh-model-${id}" value="${escHtml(c.model || '')}" placeholder="passed as --model when set" style="width:100%"></div>
        <label>Config file${infoBtn('Where its own settings file is, so it can be opened in the file manager (✏ beside it on Controls). Empty: where it usually keeps it, shown greyed in the box.')}</label><div style="display:flex;gap:6px"><input class="input flex1" id="sh-path-${id}" data-path-pick="file" value="${escHtml(c.configPath || '')}" placeholder="${escHtml(h.configPathHint || '/path/to/config')}"></div>
        <label>Environment${infoBtn('Variables set before it starts, one KEY=VALUE per line — an API key it reads, for instance. Empty by default.')}</label><div><textarea class="input" id="sh-env-${id}" rows="2" placeholder="KEY=VALUE (one per line) — exported before launch" style="width:100%">${escHtml(c.env || '')}</textarea></div>
        ${harnessTeamUseHtml(h)}
      </div>
      <div class="toolbar" style="gap:6px;margin-top:8px"><button class="btn btn-sm btn-blue" onclick="otherHarnessSave(${jsArg(h.id)})">Save</button>
        <button class="btn btn-sm" onclick="harnessOpen(${jsArg(h.id)})" title="Its terminal on the Harness tab">▶ Open</button>
        <span class="status-line" id="sh-status-${id}"></span></div>
    </div>`;
  }).join('') || (teamCard ? '' : '<div class="card"><div class="placeholder">No CLI harness is installed here (Controls → Add another agent).</div></div>');
}

async function otherHarnessSave(id) {
  const v = k => document.getElementById(`sh-${k}-${id}`).value;
  try {
    await apiFetch(`/api/harness/${encodeURIComponent(id)}/config`, { method: 'POST', body: { launchCmd: v('launch'), model: v('model'), configPath: v('path'), env: v('env') } });
    setStatus(document.getElementById(`sh-status-${id}`), '✓ Saved', 'ok');
  } catch (e) { setStatus(document.getElementById(`sh-status-${id}`), e.message, 'err'); }
}

// Their panels are made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const at = document.getElementById('sp-backups');
  for (const id of ['sp-opendots', 'sp-harness-others']) if (at && !document.getElementById(id)) at.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id }));
});
