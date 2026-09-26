'use strict';

const { WebSocketServer } = require('ws');

const { WORKSPACE_DIR } = require('./paths');

let pty = null;

/**
 * Lazy-load node-pty on demand. Retrying on every connection (instead of a
 * single require at startup) means installing node-pty from the dashboard
 * makes terminals work immediately — no server restart needed.
 * (Failed requires are not cached by Node, so retrying is safe/cheap.)
 */
function getPty() {
  if (pty) return pty;
  try { pty = require('node-pty'); }
  catch { /* still missing — handlers surface the install hint */ }
  return pty;
}

/** Bridge one WebSocket to a login shell in a PTY. */
function shellSession(ws, rows) {
  const ptyMod = getPty();
  if (!ptyMod) {
    ws.send(JSON.stringify({ type: 'output', data: '\r\nnode-pty is not installed.\r\nInstall it from Settings → System Tools, then reopen this terminal.\r\n' }));
    ws.close();
    return;
  }

  // The host's own shell, from the one place that decides it. `$SHELL` is
  // unset on Windows and `/bin/bash` is not there, so this used to spawn
  // nothing and report "Failed to spawn shell" as if node-pty were at fault.
  // An interactive terminal keeps the profile a scripted call suppresses:
  // this is a person's prompt, and their aliases belong in it.
  const hostShell = require('./shell').spec({ interactive: true });
  let ptyProc;
  try {
    ptyProc = ptyMod.spawn(hostShell.file, [], {
      name: 'xterm-256color',
      cols: 80, rows,
      cwd: process.env.HOME || WORKSPACE_DIR,
      env: process.env,
    });
  } catch (e) {
    ws.send(JSON.stringify({ type: 'output', data: `\r\nFailed to spawn shell: ${e.message}\r\n` }));
    ws.close();
    return;
  }

  ptyProc.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'output', data }));
  });

  ptyProc.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      ws.close();
    }
  });

  ws.on('message', raw => {
    try {
      const { type, data, cols, rows: r } = JSON.parse(raw.toString());
      if (type === 'input')  ptyProc.write(data);
      if (type === 'resize') ptyProc.resize(Math.max(2, cols), Math.max(2, r));
    } catch {}
  });

  ws.on('close', () => { try { ptyProc.kill(); } catch {} });
}

/**
 * Attach WebSocket terminal endpoints to an existing HTTP server:
 * /ws/terminal for the Terminal tab, /ws/harness for the per-harness
 * launchers on the Harness tab.
 */
function setup(httpServer) {
  const termWss    = new WebSocketServer({ noServer: true });
  const harnessWss = new WebSocketServer({ noServer: true });

  // Route WS upgrades; strip permessage-deflate to avoid RSV1 frame errors with ws@8
  httpServer.on('upgrade', (req, socket, head) => {
    delete req.headers['sec-websocket-extensions'];
    // Both sockets are a shell on this machine: the "host" right, a recent
    // sign-in, and this panel's own page (modules/auth/gate.js).
    if (!require('./auth/gate').upgradeAllowed(req, 'host')) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    if (req.url === '/ws/terminal') {
      termWss.handleUpgrade(req, socket, head, ws => termWss.emit('connection', ws, req));
    } else if (req.url.startsWith('/ws/harness')) {
      harnessWss.handleUpgrade(req, socket, head, ws => harnessWss.emit('connection', ws, req));
    } else if (req.url.startsWith('/ws/lsp')) {
      require('./projects/lsp').upgrade(req, socket, head);   // a language server, for the Projects editor
    } else {
      socket.destroy();
    }
  });

  termWss.on   ('connection', ws => shellSession(ws, 24));
  harnessWss.on('connection', ws => shellSession(ws, 20));
}

module.exports = { setup };
