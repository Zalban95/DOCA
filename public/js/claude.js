/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — CODE TOOLS + CLAUDE CODE MANAGEMENT
   ═══════════════════════════════════════════════════════ */

let claudeRunning  = false;
let claudeHistory  = [];
let claudeInteractive = false;

let _codeTools    = [];
let _codeExpanded = new Set(); // IDs of rows pinned open

/* ── Code tools picker ────────────────────────────────── */
function codeInit() {
  claudeCheckStatus();
  codeRefresh();
}

async function codeRefresh() {
  const list = document.getElementById('code-tools-list');
  if (!list) return;
  list.innerHTML = '<div class="placeholder pulse">Detecting…</div>';
  try {
    const data = await apiFetch('/api/code/tools');
    _codeTools    = data.tools || [];
    _codeExpanded = new Set(data.expanded || []);
    _codeRender();
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

function _codeRender() {
  const list = document.getElementById('code-tools-list');
  if (!list) return;
  if (!_codeTools.length) { list.innerHTML = '<div class="placeholder">No tools found</div>'; return; }

  list.innerHTML = _codeTools.map(t => {
    const expanded = _codeExpanded.has(t.id);
    const pinned   = t.pinned; // comes from server (same as expanded)
    return `
      <div class="code-tool-accordion ${expanded ? 'expanded' : ''}" id="code-acc-${t.id}">
        <div class="code-tool-header" onclick="codeToggle('${t.id}')">
          <span class="code-acc-chevron">${expanded ? '▼' : '▶'}</span>
          <span class="code-tool-name">${t.label}</span>
          <span class="badge ${t.detected ? 'badge-green' : 'badge-red'}" style="font-size:9px;margin-left:6px">
            ${t.detected ? (t.version || 'installed') : 'not found'}
          </span>
          <button class="code-tool-pin-btn ${expanded ? 'pinned' : ''}"
                  title="${expanded ? 'Unpin (will collapse on reload)' : 'Pin open (stays expanded)'}"
                  onclick="event.stopPropagation(); codePinToggle('${t.id}')">📌</button>
        </div>
        <div class="code-tool-body" style="display:${expanded ? 'flex' : 'none'}">
          ${t.detected
            ? `<button class="btn btn-sm btn-green" onclick="termLaunchCommand('${t.cmd}')">▶ Launch in Terminal</button>
               <span style="font-size:10px;color:var(--muted);margin-left:8px">${t.cmd}</span>`
            : `<span style="font-size:11px;color:var(--muted)">Not installed.&nbsp;</span>
               <a href="${t.url}" target="_blank" class="btn btn-xs">Install…</a>
               <span style="font-size:10px;color:var(--muted);margin-left:8px">${t.installHint}</span>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function codeToggle(id) {
  const acc  = document.getElementById(`code-acc-${id}`);
  const body = acc?.querySelector('.code-tool-body');
  const chev = acc?.querySelector('.code-acc-chevron');
  if (!acc) return;
  const open = acc.classList.toggle('expanded');
  if (body) body.style.display = open ? 'flex' : 'none';
  if (chev) chev.textContent   = open ? '▼' : '▶';
  // Update pin button state
  const pinBtn = acc.querySelector('.code-tool-pin-btn');
  if (pinBtn) pinBtn.classList.toggle('pinned', _codeExpanded.has(id));
}

async function codePinToggle(id) {
  if (_codeExpanded.has(id)) {
    _codeExpanded.delete(id);
  } else {
    _codeExpanded.add(id);
    // Ensure the row is expanded when pinned
    const acc  = document.getElementById(`code-acc-${id}`);
    if (acc && !acc.classList.contains('expanded')) codeToggle(id);
  }
  // Update visual
  const pinBtn = document.querySelector(`#code-acc-${id} .code-tool-pin-btn`);
  if (pinBtn) {
    pinBtn.classList.toggle('pinned', _codeExpanded.has(id));
    pinBtn.title = _codeExpanded.has(id) ? 'Unpin (will collapse on reload)' : 'Pin open (stays expanded)';
  }
  try { await apiFetch('/api/code/tools/pin', { method: 'POST', body: { expanded: [..._codeExpanded] } }); } catch {}
}

function claudeInit() {
  claudeCheckStatus();
}

async function claudeCheckStatus() {
  const badge   = document.getElementById('claude-status-badge');
  const version = document.getElementById('claude-version');
  const stopBtn = document.getElementById('claude-stop-btn');

  badge.textContent = 'Checking…';
  badge.className   = 'badge badge-blue';

  try {
    const data = await apiFetch('/api/claude/status');
    if (data.available) {
      badge.textContent = 'Available';
      badge.className   = 'badge badge-green';
      version.textContent = data.version || '';
    } else {
      badge.textContent = 'Not found';
      badge.className   = 'badge badge-red';
      version.textContent = 'claude CLI not in PATH';
    }
    claudeRunning = data.running;
    stopBtn.style.display = data.running ? 'inline-flex' : 'none';
    _claudeUpdateInputMode();
  } catch (e) {
    badge.textContent = 'Error';
    badge.className   = 'badge badge-red';
    version.textContent = e.message;
  }
}

/** Start claude interactively — opens the Terminal tab and runs `claude` there */
function claudeStart() {
  termLaunchCommand('claude');
}

/** Send a line to the running interactive session */
async function claudeSendStdin(text) {
  try {
    await apiFetch('/api/claude/stdin', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    // Echo input in the console
    const output = document.getElementById('claude-output');
    const echoEl = document.createElement('div');
    echoEl.className = 'claude-prompt-echo';
    echoEl.textContent = `❯ ${text}`;
    output.appendChild(echoEl);
    output.scrollTop = output.scrollHeight;
  } catch (e) {
    const output = document.getElementById('claude-output');
    const errEl  = document.createElement('div');
    errEl.className = 'claude-stderr';
    errEl.textContent = `stdin error: ${e.message}`;
    output.appendChild(errEl);
  }
}

/** One-shot: run claude -p <prompt> */
function claudeRun() {
  const input  = document.getElementById('claude-input');
  const output = document.getElementById('claude-output');
  const prompt = input.value.trim();
  if (!prompt) return;

  // If interactive session is active, send as stdin instead
  if (claudeInteractive && claudeRunning) {
    claudeSendStdin(prompt);
    input.value = '';
    return;
  }

  claudeHistory.push({ prompt, time: new Date().toISOString() });
  renderClaudeHistory();

  input.value = '';
  output.innerHTML = '';

  const promptEl = document.createElement('div');
  promptEl.className = 'claude-prompt-echo';
  promptEl.textContent = `❯ ${prompt}`;
  output.appendChild(promptEl);

  const responseEl = document.createElement('div');
  responseEl.className = 'claude-response';
  output.appendChild(responseEl);

  claudeRunning     = true;
  claudeInteractive = false;
  document.getElementById('claude-stop-btn').style.display = 'inline-flex';
  _claudeUpdateInputMode();

  fetch('/api/claude/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          _claudeSessionEnded(responseEl, output, null);
          return;
        }
        const text = decoder.decode(value);
        text.split('\n').forEach(line => {
          if (!line.startsWith('data: ')) return;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'stdout') {
              responseEl.textContent += evt.text;
            } else if (evt.type === 'stderr') {
              const err = document.createElement('span');
              err.className = 'claude-stderr';
              err.textContent = evt.text;
              responseEl.appendChild(err);
            } else if (evt.type === 'done') {
              claudeHistory[claudeHistory.length - 1].exitCode = evt.code;
              renderClaudeHistory();
              _claudeSessionEnded(responseEl, output, evt.code);
              return;
            }
          } catch {}
        });
        output.scrollTop = output.scrollHeight;
        read();
      });
    }
    read();
  }).catch(e => {
    responseEl.textContent = `Error: ${e.message}`;
    _claudeSessionEnded(responseEl, output, 1);
  });
}

function _claudeSessionEnded(responseEl, output, code) {
  claudeRunning     = false;
  claudeInteractive = false;
  document.getElementById('claude-stop-btn').style.display = 'none';
  _claudeUpdateInputMode();
  const doneEl = document.createElement('div');
  doneEl.className = 'claude-done';
  doneEl.textContent = code === null ? '— session ended —' : `— done (exit ${code}) —`;
  output.appendChild(doneEl);
  output.scrollTop = output.scrollHeight;
}

/** Update input placeholder and Run button label based on mode */
function _claudeUpdateInputMode() {
  const input   = document.getElementById('claude-input');
  const runBtn  = document.getElementById('claude-run-btn');
  const startBtn = document.getElementById('claude-start-btn');
  if (!input || !runBtn || !startBtn) return;

  if (claudeInteractive && claudeRunning) {
    input.placeholder = 'Type and press Enter to send input to Claude…';
    runBtn.textContent = '↩ Send';
    startBtn.disabled = true;
  } else if (claudeRunning) {
    input.placeholder = 'Running…';
    startBtn.disabled = true;
  } else {
    input.placeholder = 'Enter a one-shot prompt for Claude Code…';
    runBtn.textContent = '▶ Run';
    startBtn.disabled = false;
  }
}

async function claudeStop() {
  try {
    await apiFetch('/api/claude/stop', { method: 'POST' });
    claudeRunning     = false;
    claudeInteractive = false;
    document.getElementById('claude-stop-btn').style.display = 'none';
    _claudeUpdateInputMode();
  } catch (e) { alert(`Stop error: ${e.message}`); }
}

function renderClaudeHistory() {
  const el = document.getElementById('claude-history');
  if (!claudeHistory.length) {
    el.innerHTML = '<div class="placeholder">No commands run yet</div>';
    return;
  }
  el.innerHTML = claudeHistory.slice().reverse().map(h => `
    <div class="claude-hist-item fade-in">
      <span class="claude-hist-prompt">${escapeHtmlClaude(h.prompt)}</span>
      <span class="claude-hist-time">${new Date(h.time).toLocaleTimeString('en-GB', { hour12: false })}</span>
      ${h.exitCode !== undefined ? `<span class="badge ${h.exitCode === 0 ? 'badge-green' : 'badge-red'}">${h.exitCode}</span>` : ''}
    </div>
  `).join('');
}

function escapeHtmlClaude(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
