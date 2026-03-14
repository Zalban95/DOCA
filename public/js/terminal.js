/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — TERMINAL (multi-session xterm.js)
   ═══════════════════════════════════════════════════════ */

let _termSessions = []; // { id, term, fit, ws, ro }
let _termNextId   = 1;

function termInit() {
  if (_termSessions.length === 0) termAddSession();
  else _termSessions.forEach(s => requestAnimationFrame(() => _termSessionFit(s.id)));
}

function termAddSession() {
  const id       = _termNextId++;
  const sessions = document.getElementById('term-sessions');
  if (!sessions) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'term-session-wrap';
  wrapper.id        = `term-session-${id}`;
  wrapper.innerHTML = `
    <div class="term-session-header">
      <span class="term-session-label">Terminal ${id}</span>
      <span class="term-session-status" id="term-st-${id}">○ connecting…</span>
      <button class="btn btn-xs btn-red" onclick="termCloseSession(${id})" title="Close">✕</button>
    </div>
    <div class="term-session-container" id="term-cont-${id}"></div>
  `;
  sessions.appendChild(wrapper);

  const session = { id, term: null, fit: null, ws: null, ro: null };
  _termSessions.push(session);

  if (typeof Terminal === 'undefined') {
    document.getElementById(`term-cont-${id}`).innerHTML =
      '<div style="padding:12px;font-size:11px;color:var(--muted)">xterm.js not loaded</div>';
    return;
  }

  const term = new Terminal({
    cursorBlink: true,
    scrollOnUserInput: true,
    fontSize: 13,
    fontFamily: '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
    scrollback: 5000,
    allowProposedApi: true,
    theme: {
      background:    '#0d1117', foreground:    '#c9d1d9',
      cursor:        '#58a6ff', cursorAccent:  '#0d1117',
      selectionBackground: 'rgba(88,166,255,0.25)',
      black:   '#484f58', red:     '#ff7b72', green:   '#3fb950', yellow:  '#d29922',
      blue:    '#58a6ff', magenta: '#bc8cff', cyan:    '#39c5cf', white:   '#b1bac4',
      brightBlack:   '#6e7681', brightRed:     '#ffa198', brightGreen:   '#56d364',
      brightYellow:  '#e3b341', brightBlue:    '#79c0ff', brightMagenta: '#d2a8ff',
      brightCyan:    '#56d4dd', brightWhite:   '#f0f6fc',
    }
  });

  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);

  const container = document.getElementById(`term-cont-${id}`);
  term.open(container);
  session.term = term;
  session.fit  = fit;

  requestAnimationFrame(() => { try { fit.fit(); } catch {} });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => _termSessionFit(id));
    ro.observe(container);
    session.ro = ro;
  }

  _termSessionConnect(id);
  _termUpdateCount();

  wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function termCloseSession(id) {
  const idx = _termSessions.findIndex(s => s.id === id);
  if (idx === -1) return;
  const s = _termSessions[idx];
  if (s.ro)   { try { s.ro.disconnect(); } catch {} }
  if (s.ws)   { try { s.ws.close(); } catch {} }
  if (s.term) { try { s.term.dispose(); } catch {} }
  _termSessions.splice(idx, 1);
  document.getElementById(`term-session-${id}`)?.remove();
  _termUpdateCount();
}

function _termSessionConnect(id) {
  const session  = _termSessions.find(s => s.id === id);
  if (!session) return;

  const statusEl = document.getElementById(`term-st-${id}`);
  const setSt    = (t, c) => { if (statusEl) { statusEl.textContent = t; statusEl.style.color = c; } };

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws    = new WebSocket(`${proto}//${location.host}/ws/terminal`);
  session.ws  = ws;

  setSt('○ connecting…', 'var(--muted)');

  ws.onopen = () => {
    setSt('● connected', 'var(--green)');
    _termSessionFit(id);
  };

  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'output') session.term?.write(msg.data);
      if (msg.type === 'exit') {
        session.term?.writeln('\r\n\x1b[33m[session ended]\x1b[0m');
        session.ws = null;
        setSt('○ disconnected', 'var(--red)');
      }
    } catch {}
  };

  ws.onclose = () => { setSt('○ disconnected', 'var(--red)'); session.ws = null; };

  ws.onerror = () => {
    session.term?.writeln('\r\n\x1b[31m[connection error — is node-pty installed?]\x1b[0m\r\n');
  };

  session.term?.onData(data => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'input', data }));
  });
}

function _termSessionFit(id) {
  const s = _termSessions.find(s => s.id === id);
  if (!s?.fit) return;
  try {
    s.fit.fit();
    if (s.ws?.readyState === WebSocket.OPEN)
      s.ws.send(JSON.stringify({ type: 'resize', cols: s.term.cols, rows: s.term.rows }));
  } catch {}
}

function _termUpdateCount() {
  const el = document.getElementById('term-session-count');
  if (el) el.textContent = _termSessions.length > 0 ? `${_termSessions.length} session${_termSessions.length > 1 ? 's' : ''}` : '';
}

/* ── Legacy compat ────────────────────────────────────── */

function termNewSession() { termAddSession(); }

function termLaunchCommand(cmd) {
  nav('terminal');
  const send = () => {
    const s = _termSessions[_termSessions.length - 1];
    if (s?.ws?.readyState === WebSocket.OPEN) {
      s.ws.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
    }
  };
  if (_termSessions.length === 0) {
    const wait = setInterval(() => {
      if (_termSessions.length > 0 && _termSessions[_termSessions.length - 1]?.ws?.readyState === WebSocket.OPEN) {
        clearInterval(wait); send();
      }
    }, 200);
    setTimeout(() => clearInterval(wait), 8000);
  } else {
    send();
  }
}
