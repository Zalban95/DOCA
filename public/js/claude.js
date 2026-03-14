/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — CODE TOOLS + CLAUDE CODE MANAGEMENT
   ═══════════════════════════════════════════════════════ */

let claudeRunning     = false;
let claudeHistory     = [];
let claudeInteractive = false;

let _codeTools    = [];
let _codeExpanded = new Set();
let _codeTerms    = {}; // toolId -> { term, fit, ws }

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

  // Dispose any existing terminals before re-rendering
  Object.keys(_codeTerms).forEach(id => _codeTermClose(id));

  list.innerHTML = _codeTools.map(t => {
    const expanded = _codeExpanded.has(t.id);
    return `
      <div class="code-tool-accordion ${expanded ? 'expanded' : ''}" id="code-acc-${t.id}">
        <div class="code-tool-header" onclick="codeToggle('${t.id}')">
          <span class="code-acc-chevron">${expanded ? '▼' : '▶'}</span>
          <span class="code-tool-name">${t.label}</span>
          <span class="badge ${t.detected ? 'badge-green' : 'badge-red'}" style="font-size:9px;margin-left:6px">
            ${t.detected ? (t.version || 'installed') : 'not found'}
          </span>
          <button class="code-tool-pin-btn ${_codeExpanded.has(t.id) ? 'pinned' : ''}"
                  title="${_codeExpanded.has(t.id) ? 'Unpin (will collapse on reload)' : 'Pin open (stays expanded)'}"
                  onclick="event.stopPropagation(); codePinToggle('${t.id}')">📌</button>
        </div>
        <div class="code-tool-body" style="display:${expanded ? 'flex' : 'none'}">
          <div class="code-tool-config-row">
            <span class="input-label" style="flex-shrink:0">Config file</span>
            <input class="input flex1" id="code-cfg-${t.id}"
                   value="${(t.configPath || '').replace(/"/g, '&quot;')}"
                   placeholder="e.g. ~/.aider.conf.yml">
            <button class="btn btn-xs" onclick="codeConfigSave('${t.id}')">Save</button>
          </div>
          ${t.detected
            ? `<div class="code-tool-term-wrap">
                 <div class="code-tool-term-toolbar">
                   <button class="btn btn-xs btn-green"
                           onclick="event.stopPropagation(); _codeTermLaunch('${t.id}', '${t.cmd}')">
                     ▶ Launch ${t.label}
                   </button>
                   <span class="code-tool-term-status" id="code-term-status-${t.id}">○ ready</span>
                 </div>
                 <div class="code-tool-term" id="code-term-${t.id}"></div>
               </div>`
            : `<div class="code-tool-missing">
                 <span>Not installed — </span>
                 <a href="${t.url}" target="_blank" class="btn btn-xs">Install…</a>
                 <code class="code-tool-hint">${t.installHint}</code>
               </div>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Re-open terminals for expanded tools
  _codeTools
    .filter(t => _codeExpanded.has(t.id) && t.detected)
    .forEach(t => requestAnimationFrame(() => _codeTermOpen(t.id)));
}

function codeToggle(id) {
  const acc  = document.getElementById(`code-acc-${id}`);
  const body = acc?.querySelector('.code-tool-body');
  const chev = acc?.querySelector('.code-acc-chevron');
  if (!acc) return;
  const open = acc.classList.toggle('expanded');
  if (body) body.style.display = open ? 'flex' : 'none';
  if (chev) chev.textContent   = open ? '▼' : '▶';

  const tool = _codeTools.find(t => t.id === id);
  if (open && tool?.detected) {
    requestAnimationFrame(() => _codeTermOpen(id));
  } else if (!open && !_codeExpanded.has(id)) {
    _codeTermClose(id);
  }

  const pinBtn = acc.querySelector('.code-tool-pin-btn');
  if (pinBtn) pinBtn.classList.toggle('pinned', _codeExpanded.has(id));
}

async function codePinToggle(id) {
  if (_codeExpanded.has(id)) {
    _codeExpanded.delete(id);
  } else {
    _codeExpanded.add(id);
    const acc = document.getElementById(`code-acc-${id}`);
    if (acc && !acc.classList.contains('expanded')) codeToggle(id);
  }
  const pinBtn = document.querySelector(`#code-acc-${id} .code-tool-pin-btn`);
  if (pinBtn) {
    pinBtn.classList.toggle('pinned', _codeExpanded.has(id));
    pinBtn.title = _codeExpanded.has(id)
      ? 'Unpin (will collapse on reload)'
      : 'Pin open (stays expanded)';
  }
  try { await apiFetch('/api/code/tools/pin', { method: 'POST', body: { expanded: [..._codeExpanded] } }); } catch {}
}

async function codeConfigSave(id) {
  const input = document.getElementById(`code-cfg-${id}`);
  if (!input) return;
  try {
    await apiFetch(`/api/code/tools/${id}/config`, { method: 'POST', body: { configPath: input.value.trim() } });
    input.style.borderColor = 'var(--green)';
    setTimeout(() => { input.style.borderColor = ''; }, 1500);
  } catch (e) { alert(`Save error: ${e.message}`); }
}

/* ── Per-tool embedded terminal ──────────────────────── */

function _codeTermOpen(id) {
  const container = document.getElementById(`code-term-${id}`);
  if (!container) return;

  if (_codeTerms[id]) {
    requestAnimationFrame(() => _codeTermFit(id));
    return;
  }

  if (typeof Terminal === 'undefined') {
    container.innerHTML = '<div style="padding:8px;font-size:11px;color:var(--muted)">xterm.js not loaded</div>';
    return;
  }

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
    scrollback: 2000,
    theme: {
      background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff',
      black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
    },
  });

  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(container);
  requestAnimationFrame(() => { try { fit.fit(); } catch {} });

  _codeTerms[id] = { term, fit, ws: null };

  const proto  = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws     = new WebSocket(`${proto}//${location.host}/ws/code?tool=${id}`);
  _codeTerms[id].ws = ws;

  const statusEl = document.getElementById(`code-term-status-${id}`);
  const setStatus = (txt, color) => {
    if (statusEl) { statusEl.textContent = txt; statusEl.style.color = color; }
  };

  setStatus('○ connecting…', 'var(--muted)');

  let _didOpen = false;

  ws.onopen = () => {
    _didOpen = true;
    setStatus('● connected', 'var(--green)');
    try { fit.fit(); } catch {}
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };

  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'output') term.write(msg.data);
      if (msg.type === 'exit') {
        term.writeln('\r\n\x1b[33m[session ended]\x1b[0m');
        setStatus('○ disconnected', 'var(--red)');
        if (_codeTerms[id]) _codeTerms[id].ws = null;
      }
    } catch {}
  };

  ws.onclose = () => {
    setStatus('○ disconnected', 'var(--red)');
    if (_codeTerms[id]) _codeTerms[id].ws = null;
  };

  ws.onerror = () => {
    if (!_didOpen) {
      setStatus('✗ node-pty missing', 'var(--red)');
      ptyErrorBanner(container);
    } else {
      term.writeln('\r\n\x1b[31m[connection error]\x1b[0m\r\n');
    }
  };

  term.onData(data => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'input', data }));
  });

  // Resize observer to re-fit when container size changes
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => _codeTermFit(id));
    ro.observe(container);
    _codeTerms[id].ro = ro;
  }
}

function _codeTermFit(id) {
  const t = _codeTerms[id];
  if (!t?.fit) return;
  try {
    t.fit.fit();
    if (t.ws?.readyState === WebSocket.OPEN)
      t.ws.send(JSON.stringify({ type: 'resize', cols: t.term.cols, rows: t.term.rows }));
  } catch {}
}

function _codeTermLaunch(id, cmd) {
  const t = _codeTerms[id];
  if (!t) { _codeTermOpen(id); setTimeout(() => _codeTermLaunch(id, cmd), 600); return; }
  if (!t.ws || t.ws.readyState !== WebSocket.OPEN) {
    _codeTermClose(id);
    _codeTermOpen(id);
    setTimeout(() => _codeTermLaunch(id, cmd), 600);
    return;
  }
  t.ws.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
}

function _codeTermClose(id) {
  const t = _codeTerms[id];
  if (!t) return;
  if (t.ro)   { try { t.ro.disconnect(); } catch {} }
  if (t.ws)   { try { t.ws.close(); } catch {} }
  if (t.term) { try { t.term.dispose(); } catch {} }
  delete _codeTerms[id];
}

/* ── Claude one-shot ──────────────────────────────────── */
function claudeInit() {
  claudeCheckStatus();
}

async function claudeCheckStatus() {
  const badge   = document.getElementById('claude-status-badge');
  const version = document.getElementById('claude-version');
  const stopBtn = document.getElementById('claude-stop-btn');

  if (!badge) return;

  badge.textContent = 'Checking…';
  badge.className   = 'badge badge-blue';

  try {
    const data = await apiFetch('/api/claude/status');
    if (data.available) {
      badge.textContent = 'Available';
      badge.className   = 'badge badge-green';
      if (version) version.textContent = data.version || '';
    } else {
      badge.textContent = 'Not found';
      badge.className   = 'badge badge-red';
      if (version) version.textContent = 'claude CLI not in PATH';
    }
    claudeRunning = data.running;
    if (stopBtn) stopBtn.style.display = data.running ? 'inline-flex' : 'none';
    _claudeUpdateInputMode();
  } catch (e) {
    badge.textContent = 'Error';
    badge.className   = 'badge badge-red';
    if (version) version.textContent = e.message;
  }
}

function claudeStart() {
  // Launch claude via the Code tab terminal if available, else fall back to legacy
  const claudeTool = _codeTools.find(t => t.id === 'claude');
  if (claudeTool?.detected && _codeTerms['claude']) {
    _codeTermLaunch('claude', 'claude');
  } else {
    const acc = document.getElementById('code-acc-claude');
    if (acc) {
      if (!acc.classList.contains('expanded')) codeToggle('claude');
      setTimeout(() => _codeTermLaunch('claude', 'claude'), 700);
    }
  }
}

async function claudeSendStdin(text) {
  try {
    await apiFetch('/api/claude/stdin', { method: 'POST', body: JSON.stringify({ text }) });
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

function claudeRun() {
  const input  = document.getElementById('claude-input');
  const output = document.getElementById('claude-output');
  const prompt = input.value.trim();
  if (!prompt) return;

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
        if (done) { _claudeSessionEnded(responseEl, output, null); return; }
        decoder.decode(value).split('\n').forEach(line => {
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

function _claudeUpdateInputMode() {
  const input    = document.getElementById('claude-input');
  const runBtn   = document.getElementById('claude-run-btn');
  const startBtn = document.getElementById('claude-start-btn');
  if (!input || !runBtn) return;

  if (claudeInteractive && claudeRunning) {
    input.placeholder = 'Type and press Enter to send input to Claude…';
    runBtn.textContent = '↩ Send';
    if (startBtn) startBtn.disabled = true;
  } else if (claudeRunning) {
    input.placeholder = 'Running…';
    if (startBtn) startBtn.disabled = true;
  } else {
    input.placeholder = 'Enter a one-shot prompt for Claude Code…';
    runBtn.textContent = '▶ Run';
    if (startBtn) startBtn.disabled = false;
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
  if (!el) return;
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
