/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — LOGS  (SSE streaming, one or more sources)
   ═══════════════════════════════════════════════════════ */

/* Which sources are being followed. Empty means "auto": whichever harness is
   selected in DOCA, resolved server-side so it stays right when the selection
   changes without this tab knowing. */
let logSources = [];
let logSourceMeta = [];

/* A source's colour must survive a reconnect, so it is assigned by position in
   the sorted id list rather than by arrival order. Red and amber are missing
   from this palette on purpose: they mean error and warning, and a source that
   borrowed either would be a line you had to read twice to classify. */
const LOG_HUES = ['blue', 'purple', 'teal', 'cyan', 'green'];

function logHue(id) {
  const ids = logSourceMeta.map(s => s.id).sort();
  const i = ids.indexOf(id);
  return LOG_HUES[(i < 0 ? 0 : i) % LOG_HUES.length];
}

async function logsLoadSources() {
  try {
    const data = await apiFetch('/api/logs/sources');
    logSourceMeta = data.sources || [];
  } catch { logSourceMeta = []; }
  logsRenderPicker();
}

function logsRenderPicker() {
  const box = document.getElementById('log-sources');
  if (!box) return;
  const auto = logSources.length === 0;
  box.innerHTML = `
    <label class="log-src ${auto ? 'on' : ''}" title="Follow whichever harness is selected in DOCA">
      <input type="checkbox" ${auto ? 'checked' : ''} onchange="logsPick('auto', this.checked)">
      <span>Auto</span>
    </label>
    ${logSourceMeta.map(s => `
      <label class="log-src src-${logHue(s.id)} ${logSources.includes(s.id) ? 'on' : ''} ${s.available ? '' : 'off'}"
             title="${escHtml(s.available ? (s.selected ? 'Selected harness' : s.kind) : s.reason)}">
        <input type="checkbox" ${logSources.includes(s.id) ? 'checked' : ''}
               ${s.available ? '' : 'disabled'} onchange="logsPick('${s.id}', this.checked)">
        <span>${escHtml(s.label)}</span>${s.available ? '' : '<em>—</em>'}
      </label>`).join('')}`;
}

function logsPick(id, on) {
  if (id === 'auto') logSources = [];
  else if (on) logSources = [...new Set([...logSources, id])];
  else logSources = logSources.filter(x => x !== id);
  logsRenderPicker();
  clearLogs();
  startLogs();
}

function startLogs() {
  if (logSource) { logSource.close(); logSource = null; }
  if (!logSourceMeta.length) logsLoadSources();
  const spec = logSources.length ? logSources.join(',') : 'auto';
  logSource = new EventSource(`/api/logs?tail=200&sources=${encodeURIComponent(spec)}`);
  logSource.onmessage = e => appendLog(JSON.parse(e.data));
  logSource.onerror = () => {
    appendLog({ source: 'panel', label: 'panel', level: 'warn', text: 'stream disconnected — retrying…' });
    logSource.close(); logSource = null;
    setTimeout(startLogs, 4000);
  };
  // A standing state, not an event: the stream is either up or it is not, and
  // a ✓ that fades after three seconds leaves the tab looking idle while it is
  // still streaming. `{clear: 0}` is the rule for describing the machine.
  setStatus(document.getElementById('log-status'), 'streaming', 'ok', { clear: 0 });
}

/* Accepts the old bare-string payload as well as the object one, so a browser
   holding a cached copy of this file against a newer server still shows lines
   instead of "[object Object]". */
function appendLog(line) {
  const out = document.getElementById('log-out');
  if (!out) return;

  if (typeof line === 'string') line = { text: line, level: null, source: null, label: null };
  const level = line.level || logLevelOf(line.text || '');

  const el = document.createElement('span');
  el.className = `ll ${level === 'error' ? 'e' : level === 'warn' ? 'w' : 'i'}`;

  /* The tag is its own element: it must never be scanned for the word "error",
     which is exactly what the old whole-line test did. */
  if (line.source && (logSources.length > 1 || logSourceMeta.length > 1)) {
    const tag = document.createElement('b');
    tag.className = `log-tag src-${logHue(line.source)}`;
    tag.textContent = line.label || line.source;
    el.appendChild(tag);
  }
  el.appendChild(document.createTextNode((line.text || '') + '\n'));

  out.appendChild(el);
  while (out.children.length > 3000) out.removeChild(out.firstChild);
  if (autoScroll) out.scrollTop = out.scrollHeight;
}

/* Only for a line the server did not label — the old shape, and nothing else. */
function logLevelOf(text) {
  const l = String(text).toLowerCase();
  if (l.includes('error') || l.includes('err:') || l.includes('[stderr]')) return 'error';
  if (l.includes('warn')) return 'warn';
  return 'info';
}

function clearLogs() { document.getElementById('log-out').innerHTML = ''; }

function toggleScroll() {
  autoScroll = !autoScroll;
  document.getElementById('scroll-btn').textContent = `Autoscroll ${autoScroll ? 'ON' : 'OFF'}`;
}
