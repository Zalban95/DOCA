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
