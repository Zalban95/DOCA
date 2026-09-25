/* ═══════════════════════════════════════════════════════
   Harness tab: an external harness, in an embedded terminal.
   ═══════════════════════════════════════════════════════ */

/* ── External harness: an embedded terminal ───────────── */

function _hcExternalHtml(h) {
  const cmd = h.config?.launchCmd || h.cmd || '';
  return `
    <div class="card" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <div class="hc-head">
        <span class="hc-title">${escHtml(h.label)}</span>
        <span class="badge ${h.detected ? 'badge-green' : 'badge-red'}" style="font-size:9px">${escHtml(h.detected ? (h.version || 'installed') : 'not installed')}</span>
        <div class="toolbar-right">
          <button class="btn btn-xs btn-green" onclick="harnessTermLaunch()" ${h.detected ? '' : 'disabled'}>▶ Launch</button>
          <span class="hc-term-status" id="harness-term-status">○ ready</span>
          <button class="btn btn-xs tool-gear" onclick="nav('controls'); harnessConfigToggle(${jsArg(h.id)}, true)" title="Launch command and config">⚙</button>
        </div>
      </div>
      <p class="hc-term-hint">Runs <code>${escHtml(cmd || '(no launch command set)')}</code> in a shell on the host.
        ${h.kind === 'stack' ? 'Start and stop the stack itself from the Controls page.' : ''}</p>
      <div class="hc-term" id="harness-term"></div>
    </div>`;
}

function _harnessTermOpen(h) {
  const container = document.getElementById('harness-term');
  if (!container || _harnessTerm) return;

  if (typeof Terminal === 'undefined') {
    container.innerHTML = '<div style="padding:8px;font-size:11px;color:var(--muted)">xterm.js not loaded</div>';
    return;
  }

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
    scrollback: 4000,
    theme: typeof getTerminalTheme === 'function' ? getTerminalTheme()
      : { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(container);
  requestAnimationFrame(() => { try { fit.fit(); } catch {} });

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws/harness?id=${encodeURIComponent(h.id)}`);
  _harnessTerm = { id: h.id, term, fit, ws };

  const statusEl = document.getElementById('harness-term-status');
  const setSt = (txt, color) => { if (statusEl) { statusEl.textContent = txt; statusEl.style.color = color; } };
  setSt('○ connecting…', 'var(--muted)');

  let opened = false;
  ws.onopen = () => {
    opened = true;
    setSt('● connected', 'var(--green)');
    try { fit.fit(); } catch {}
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };
  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'output') term.write(msg.data);
      if (msg.type === 'exit') {
        term.writeln('\r\n\x1b[33m[session ended]\x1b[0m');
        setSt('○ disconnected', 'var(--red)');
      }
    } catch {}
  };
  ws.onclose = () => setSt('○ disconnected', 'var(--red)');
  ws.onerror = () => {
    if (!opened) { setSt('✗ node-pty missing', 'var(--red)'); ptyErrorBanner(container); }
    else term.writeln('\r\n\x1b[31m[connection error]\x1b[0m\r\n');
  };
  term.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d })); });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      if (!_harnessTerm) return;
      try {
        _harnessTerm.fit.fit();
        if (_harnessTerm.ws?.readyState === WebSocket.OPEN)
          _harnessTerm.ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch {}
    });
    ro.observe(container);
    _harnessTerm.ro = ro;
  }
}

/** Type the harness's launch command (with its env and model) into the shell. */
function harnessTermLaunch() {
  const h = _harnesses.find(x => x.isDefault);
  if (!h) return;
  if (!_harnessTerm || _harnessTerm.ws?.readyState !== WebSocket.OPEN) {
    _harnessTermClose();
    _harnessTermOpen(h);
    setTimeout(harnessTermLaunch, 600);
    return;
  }
  const cfg = h.config || {};
  const env = (cfg.env || '').split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => `export ${l}`);
  const cmd = [cfg.launchCmd || h.cmd, cfg.model ? `--model ${cfg.model}` : ''].filter(Boolean).join(' ');
  _harnessTerm.ws.send(JSON.stringify({ type: 'input', data: [...env, cmd].join('\n') + '\n' }));
}

function _harnessTermClose() {
  if (!_harnessTerm) return;
  const t = _harnessTerm;
  _harnessTerm = null;
  if (t.ro)   { try { t.ro.disconnect(); } catch {} }
  if (t.ws)   { try { t.ws.close(); } catch {} }
  if (t.term) { try { t.term.dispose(); } catch {} }
}
