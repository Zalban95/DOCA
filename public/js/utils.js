/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SHARED UTILITIES
   ═══════════════════════════════════════════════════════ */

/**
 * Fetch JSON from the API. Throws on HTTP errors.
 * @param {string} url
 * @param {{method?:string, body?:object}} opts
 */
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  if (text.trimStart().startsWith('<'))
    throw new Error('Server returned HTML — run: git pull && sudo systemctl restart openclaw-panel');
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(`Bad JSON from ${url}: ${e.message}`); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/**
 * Escape HTML special characters (single shared implementation).
 * @param {string} str
 */
function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * POST JSON to an SSE endpoint and dispatch parsed `data: {...}` events.
 * Uses buffered decoding so events split across chunks are handled correctly.
 *
 * @param {string} url
 * @param {object|null} body - JSON body (null/undefined for empty POST)
 * @param {{
 *   method?:  string,                    - HTTP method (default POST)
 *   onEvent?: (obj: object) => void,     - every parsed event object
 *   onStatus?:(text: string) => void,    - convenience: obj.status chunks
 *   onDone?:  (obj: object) => void,     - event with truthy obj.done
 *   onError?: (err: Error) => void,      - network/stream failure
 * }} handlers
 * @returns {Promise<void>} resolves when the stream ends
 */
async function sseStream(url, body, handlers = {}) {
  const { method, onEvent, onStatus, onDone, onError } = handlers;
  try {
    const res = await fetch(url, {
      method:  method || 'POST',
      headers: body != null ? { 'Content-Type': 'application/json' } : {},
      body:    body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !res.body) throw new Error(res.statusText);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();                       // keep partial line for next chunk
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let obj;
        try { obj = JSON.parse(line.slice(6)); } catch { continue; }
        if (onEvent) onEvent(obj);
        if (typeof obj === 'string') {           // plain-string payloads (e.g. log lines)
          if (onStatus) onStatus(obj);
          continue;
        }
        if (onStatus && obj.status !== undefined) onStatus(obj.status);
        if (onDone && obj.done) onDone(obj);
      }
    }
  } catch (e) {
    if (onError) onError(e); else throw e;
  }
}

/**
 * Append streamed text to a <pre>/output element and keep it scrolled.
 * Common companion to sseStream's onStatus.
 * @param {HTMLElement} el
 * @param {string} text
 */
function appendStream(el, text) {
  if (!el) return;
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}

/**
 * Standard tool row: status icon, label, version, note and actions
 * (⬇ Install when missing & installable, doc link, ⚙ gear when settable).
 * Used by Settings → System, the Models tab AI Tools card, and any other
 * tool list that needs the same look.
 *
 * @param {{
 *   id: string, label: string, note?: string,
 *   detected: boolean, version?: string|null,
 *   canInstall?: boolean, installing?: boolean, installOnclick?: string,
 *   gearOnclick?: string, repo?: string, repoLabel?: string,
 *   extraActions?: string,   - pre-built HTML appended to the actions cell
 * }} t
 * @returns {string} HTML
 */
function toolRowHtml(t) {
  const statusIcon = t.detected ? '✓' : '✗';
  const cls        = t.detected ? 'tool-ok' : 'tool-missing';

  const versionStr = t.detected && t.version
    ? `<span class="tool-version">${escHtml(t.version)}</span>` : '';

  const installBtn = !t.detected && t.canInstall && t.installOnclick
    ? `<button class="btn btn-xs btn-teal" onclick="${t.installOnclick}" ${t.installing ? 'disabled' : ''}>
         ${t.installing ? '⏳ Installing…' : '⬇ Install'}
       </button>`
    : '';

  const repoLink = !t.detected && t.repo
    ? `<a class="tool-repo" href="${t.repo}" target="_blank" title="${t.repo}">${escHtml(t.repoLabel || t.repo)}</a>`
    : '';

  const manualNote = !t.detected && !t.canInstall && !t.extraActions
    ? `<span class="tool-manual">manual install</span>`
    : '';

  const gearBtn = t.gearOnclick
    ? `<button class="btn btn-xs tool-gear" title="Settings" onclick="${t.gearOnclick}">⚙</button>`
    : '';

  return `<div class="tool-row ${cls}" id="tool-row-${t.id}">
    <span class="tool-status">${statusIcon}</span>
    <span class="tool-label">${escHtml(t.label)}</span>
    ${versionStr}
    <span class="tool-note">${escHtml(t.note || '')}</span>
    <span class="tool-actions">${t.extraActions || ''}${installBtn}${repoLink}${manualNote}${gearBtn}</span>
  </div>`;
}

/**
 * Set text + class on a status element.
 * @param {HTMLElement} el
 * @param {string} msg
 * @param {string} [cls] - 'ok' | 'err' | 'info' | 'warn'
 */
function setStatus(el, msg, cls) {
  if (!el) return;
  el.textContent = msg;
  el.className = `status-line ${cls || ''}`;
}

/**
 * Pipe an SSE response body into an element, then call onDone.
 * @param {Response} res
 * @param {HTMLElement} el
 * @param {Function|null} onDone
 */
function streamToEl(res, el, onDone) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  function read() {
    reader.read().then(({ done, value }) => {
      if (done) { if (onDone) onDone(); return; }
      const text = decoder.decode(value);
      text.split('\n').forEach(line => {
        if (line.startsWith('data: ')) {
          try { el.textContent += JSON.parse(line.slice(6)); } catch {}
        }
      });
      el.scrollTop = el.scrollHeight;
      read();
    });
  }
  read();
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @param {number} [dp=1]
 */
function fmtBytes(bytes, dp = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dp)) + ' ' + sizes[i];
}

/**
 * Format a large count to compact form (1.2K, 3.4M).
 * @param {number} n
 */
function fmtNumber(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

/**
 * Format a duration in seconds as "3d 4h 12m" (short, human-readable).
 * @param {number} sec
 */
function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Format a date string to short locale format.
 * @param {string} dateStr
 */
function fmtDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12: false });
  } catch { return dateStr; }
}

/**
 * Debounce a function.
 * @param {Function} fn
 * @param {number} ms
 */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * Show a styled in-app confirmation modal.
 * @param {string} message
 * @param {Function} onConfirm
 * @param {Function} [onCancel]
 */
/* ── System-tools shared cache + installer ───────────── */

let _systemToolsCache = null;

/**
 * Fetch /api/system/tools once and cache the result (shared by the Models
 * tab badges and anything else needing detection state).
 * @param {boolean} [force] - bypass the cache
 */
async function getSystemTools(force = false) {
  if (_systemToolsCache && !force) return _systemToolsCache;
  const data = await apiFetch('/api/system/tools');
  _systemToolsCache = data.tools || [];
  return _systemToolsCache;
}

/**
 * Install a system tool by id (single shared install path — same endpoint
 * the Settings → System panel uses), streaming output into `outEl`.
 * Prompts for the sudo password when the tool requires it.
 * @param {string} id - system tool id (e.g. 'ollama', 'huggingface-cli')
 * @param {HTMLElement|null} outEl - <pre> for streamed output
 * @param {Function} [onDone] - called with the final done event
 */
async function systemToolInstall(id, outEl, onDone) {
  let tool = null;
  try { tool = (await getSystemTools()).find(t => t.id === id); } catch {}

  const run = async password => {
    if (outEl) { outEl.style.display = 'block'; outEl.textContent = `Installing ${id}…\n`; }
    const body = { id };
    if (password) body.password = password;
    await sseStream('/api/system/tools/install', body, {
      onStatus: text => appendStream(outEl, text),
      onDone:   obj => { _systemToolsCache = null; if (onDone) onDone(obj); },
      onError:  e => { if (outEl) outEl.textContent += `\nError: ${e.message}`; },
    });
  };

  if (tool?.needsSudo) {
    sudoAsk(`Installing "${tool.label}" requires elevated privileges.`, pw => {
      if (pw === null) return; // cancelled
      run(pw);
    });
  } else {
    run(null);
  }
}

/**
 * Show a "node-pty missing" error banner inside a terminal container.
 * Only shown when the WS connection fails before ever opening.
 * @param {HTMLElement} container - the xterm container element
 */
function ptyErrorBanner(container) {
  if (!container || container.querySelector('.term-pty-error')) return;
  const el = document.createElement('div');
  el.className = 'term-pty-error';
  el.innerHTML = `
    <span class="term-pty-error-icon">⚠</span>
    <div class="term-pty-error-body">
      <strong>Terminal unavailable</strong>
      <span>node-pty is not installed. This native addon is required for embedded terminals.</span>
      <div class="term-pty-error-actions">
        <button class="btn btn-xs btn-teal" onclick="
          nav('settings');
          setTimeout(() => document.getElementById('sysdeps-list')?.scrollIntoView({ behavior: 'smooth' }), 200);
        ">Open Settings → System Tools</button>
      </div>
    </div>`;
  container.style.position = 'relative';
  container.appendChild(el);
}

/**
 * Show a styled in-app prompt modal (replaces browser prompt()).
 * @param {string} message
 * @param {Function} onSubmit - called with the entered string
 * @param {string} [defaultValue]
 */
function appPrompt(message, onSubmit, defaultValue) {
  const modal = document.getElementById('app-prompt-modal');
  const msgEl = document.getElementById('app-prompt-message');
  const input = document.getElementById('app-prompt-input');
  const btnOk = document.getElementById('app-prompt-ok');
  const btnCan = document.getElementById('app-prompt-cancel');
  if (!modal) { const v = prompt(message, defaultValue || ''); if (v !== null) onSubmit(v); return; }

  msgEl.textContent = message;
  input.value = defaultValue || '';
  modal.classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 50);

  const cleanup = () => {
    modal.classList.remove('open');
    btnOk.onclick = null;
    btnCan.onclick = null;
    input.onkeydown = null;
  };

  const submit = () => {
    const val = input.value.trim();
    if (!val) return;
    cleanup();
    onSubmit(val);
  };

  btnOk.onclick = submit;
  btnCan.onclick = cleanup;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') cleanup();
  };
}

function appConfirm(message, onConfirm, onCancel) {
  const modal   = document.getElementById('app-confirm-modal');
  const msgEl   = document.getElementById('app-confirm-message');
  const btnOk   = document.getElementById('app-confirm-ok');
  const btnCan  = document.getElementById('app-confirm-cancel');
  if (!modal) { if (confirm(message)) onConfirm(); else if (onCancel) onCancel(); return; }

  msgEl.textContent = message;
  modal.classList.add('open');

  const cleanup = () => {
    modal.classList.remove('open');
    btnOk.onclick   = null;
    btnCan.onclick  = null;
  };

  btnOk.onclick  = () => { cleanup(); onConfirm(); };
  btnCan.onclick = () => { cleanup(); if (onCancel) onCancel(); };
}

/**
 * Show a one-button in-app notice (replaces browser alert()).
 * Reuses the confirm modal with the Cancel button hidden.
 * @param {string} message
 * @param {Function} [onClose]
 */
function appAlert(message, onClose) {
  const modal  = document.getElementById('app-confirm-modal');
  const msgEl  = document.getElementById('app-confirm-message');
  const btnOk  = document.getElementById('app-confirm-ok');
  const btnCan = document.getElementById('app-confirm-cancel');
  if (!modal) { alert(message); if (onClose) onClose(); return; }

  msgEl.textContent = message;
  btnCan.style.display = 'none';
  const prevOkClass = btnOk.className;
  btnOk.className = 'btn btn-sm btn-blue';
  btnOk.textContent = 'OK';
  modal.classList.add('open');

  btnOk.onclick = () => {
    modal.classList.remove('open');
    btnCan.style.display = '';
    btnOk.className = prevOkClass;
    btnOk.textContent = 'Confirm';
    btnOk.onclick = null;
    if (onClose) onClose();
  };
}
