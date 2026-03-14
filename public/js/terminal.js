/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — TERMINAL (xterm.js + WebSocket + node-pty)
   ═══════════════════════════════════════════════════════ */

let term        = null;
let termWs      = null;
let termFit     = null;
let termResObs  = null;

function termInit() {
  if (term) {
    _termFit();
    return;
  }
  _termCreate();
}

function _termCreate() {
  const container = document.getElementById('term-container');
  container.innerHTML = '';

  term = new Terminal({
    cursorBlink: true,
    scrollOnUserInput: true,
    fontSize: 13,
    fontFamily: '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
    scrollback: 5000,
    allowProposedApi: true,
    theme: {
      background:    '#0d1117',
      foreground:    '#c9d1d9',
      cursor:        '#58a6ff',
      cursorAccent:  '#0d1117',
      selectionBackground: 'rgba(88,166,255,0.25)',
      black:         '#484f58',
      red:           '#ff7b72',
      green:         '#3fb950',
      yellow:        '#d29922',
      blue:          '#58a6ff',
      magenta:       '#bc8cff',
      cyan:          '#39c5cf',
      white:         '#b1bac4',
      brightBlack:   '#6e7681',
      brightRed:     '#ffa198',
      brightGreen:   '#56d364',
      brightYellow:  '#e3b341',
      brightBlue:    '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan:    '#56d4dd',
      brightWhite:   '#f0f6fc',
    }
  });

  termFit = new FitAddon.FitAddon();
  term.loadAddon(termFit);
  term.open(container);
  // Defer first fit until the layout has fully settled
  requestAnimationFrame(() => { _termFit(); });

  termConnect();

  termResObs = new ResizeObserver(() => _termFit());
  termResObs.observe(container);
}

function termConnect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  termWs = new WebSocket(`${proto}//${location.host}/ws/terminal`);

  _termSetStatus('○ connecting…', 'var(--text-muted)');

  termWs.onopen = () => {
    _termSetStatus('● connected', 'var(--green)');
    _termFit();
  };

  termWs.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'output') { term.write(msg.data); term.scrollToBottom(); }
      if (msg.type === 'exit') {
        term.writeln('\r\n\x1b[33m[session ended]\x1b[0m');
        termWs = null;
        _termSetStatus('○ disconnected', 'var(--red)');
      }
    } catch {}
  };

  termWs.onclose = () => {
    _termSetStatus('○ disconnected', 'var(--red)');
  };

  termWs.onerror = () => {
    term.writeln('\r\n\x1b[31m[connection error — is node-pty installed?]\x1b[0m\r\n');
  };

  term.onData(data => {
    if (termWs?.readyState === WebSocket.OPEN)
      termWs.send(JSON.stringify({ type: 'input', data }));
    term.scrollToBottom();
  });
}

function termNewSession() {
  if (termWs) {
    termWs.onclose = null;
    termWs.close();
    termWs = null;
  }
  if (term) {
    term.clear();
    termConnect();
  } else {
    _termCreate();
  }
}

/** Navigate to the terminal tab and optionally run a command */
function termLaunchCommand(cmd) {
  nav('terminal');
  if (!term) {
    // termInit() will be called by nav(); wait for connect then send
    const waitAndSend = setInterval(() => {
      if (termWs?.readyState === WebSocket.OPEN) {
        clearInterval(waitAndSend);
        termWs.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
      }
    }, 200);
    setTimeout(() => clearInterval(waitAndSend), 8000);
  } else if (termWs?.readyState === WebSocket.OPEN) {
    termWs.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
  }
}

function _termFit() {
  if (!termFit) return;
  try {
    termFit.fit();
    if (termWs?.readyState === WebSocket.OPEN)
      termWs.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  } catch {}
}

function _termSetStatus(text, color) {
  const el = document.getElementById('term-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}
