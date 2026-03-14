/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — CLAUDE CODE MANAGEMENT
   ═══════════════════════════════════════════════════════ */

let claudeRunning  = false;
let claudeHistory  = [];
let claudeInteractive = false; // true when started via "Start Claude" (interactive mode)

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

/** Start claude interactively (no prompt — streams all output to console) */
function claudeStart() {
  const output  = document.getElementById('claude-output');
  output.innerHTML = '';

  const headerEl = document.createElement('div');
  headerEl.className = 'claude-prompt-echo';
  headerEl.textContent = '❯ claude  (interactive session started)';
  output.appendChild(headerEl);

  const responseEl = document.createElement('div');
  responseEl.className = 'claude-response';
  responseEl.id = 'claude-response-active';
  output.appendChild(responseEl);

  claudeRunning     = true;
  claudeInteractive = true;
  document.getElementById('claude-stop-btn').style.display = 'inline-flex';
  _claudeUpdateInputMode();

  fetch('/api/claude/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
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
