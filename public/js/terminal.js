/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — TERMINAL (xterm.js + WebSocket + node-pty)
   ═══════════════════════════════════════════════════════ */

let term        = null;
let termWs      = null;
let termFit     = null;
let termResObs  = null;

function termInit() {
  // #region agent log
  fetch('http://127.0.0.1:7404/ingest/a169e71a-1553-42cd-9c71-de52063f68ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e82941'},body:JSON.stringify({sessionId:'e82941',location:'terminal.js:termInit',message:'termInit called',data:{termExists:!!term},timestamp:Date.now(),runId:'post-fix2',hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  if (!term) _termCreate();
  // Trigger fit on every visit with double rAF to ensure layout is settled
  requestAnimationFrame(() => requestAnimationFrame(() => _termFit()));
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
  termConnect();

  // Initial fit for the first visit — layout is already settled one rAF after open()
  requestAnimationFrame(() => _termFit());

  // Fit whenever the terminal container is resized (window resize, panel resize)
  termResObs = new ResizeObserver(() => _termFit());
  termResObs.observe(container);

  // Fit every time the terminal tab becomes active using a MutationObserver
  // This ensures fit() runs after the CSS display:flex layout has settled
  const tabEl = document.getElementById('tab-terminal');
  if (tabEl) {
    new MutationObserver(() => {
      if (tabEl.classList.contains('active')) {
        requestAnimationFrame(() => _termFit());
      }
    }).observe(tabEl, { attributes: true, attributeFilter: ['class'] });
  }
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
  // #region agent log
  const _c = document.getElementById('term-container');
  const _cs = _c ? window.getComputedStyle(_c) : null;
  const _proposed = termFit.proposeDimensions ? termFit.proposeDimensions() : null;
  fetch('http://127.0.0.1:7404/ingest/a169e71a-1553-42cd-9c71-de52063f68ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e82941'},body:JSON.stringify({sessionId:'e82941',location:'terminal.js:_termFit',message:'_termFit called',data:{clientH:_c?.clientHeight,clientW:_c?.clientWidth,computedH:_cs?.height,computedDisplay:_cs?.display,proposed:_proposed,termCols:term?.cols,termRows:term?.rows},timestamp:Date.now(),runId:'post-fix2',hypothesisId:'H2-H3'})}).catch(()=>{});
  // #endregion
  try {
    termFit.fit();
    // #region agent log
    fetch('http://127.0.0.1:7404/ingest/a169e71a-1553-42cd-9c71-de52063f68ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e82941'},body:JSON.stringify({sessionId:'e82941',location:'terminal.js:_termFit-after',message:'fit() done',data:{cols:term?.cols,rows:term?.rows},timestamp:Date.now(),runId:'post-fix2',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    if (termWs?.readyState === WebSocket.OPEN)
      termWs.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  } catch(e) {
    // #region agent log
    fetch('http://127.0.0.1:7404/ingest/a169e71a-1553-42cd-9c71-de52063f68ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e82941'},body:JSON.stringify({sessionId:'e82941',location:'terminal.js:_termFit-catch',message:'fit() threw',data:{err:e?.message},timestamp:Date.now(),runId:'post-fix2',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
  }
}

function _termSetStatus(text, color) {
  const el = document.getElementById('term-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}
