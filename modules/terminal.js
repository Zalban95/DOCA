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

if (!getPty()) {
  console.warn('[terminal] node-pty not available — install it from Settings → System (works without restart)');
}

/**
 * Attach WebSocket terminal endpoints to an existing HTTP server.
 * Creates /ws/terminal and /ws/code upgrade paths.
 */
function setup(httpServer) {
  const termWss = new WebSocketServer({ noServer: true });
  const codeWss = new WebSocketServer({ noServer: true });

  // Route WS upgrades; strip permessage-deflate to avoid RSV1 frame errors with ws@8
  httpServer.on('upgrade', (req, socket, head) => {
    delete req.headers['sec-websocket-extensions'];
    if (req.url === '/ws/terminal') {
      termWss.handleUpgrade(req, socket, head, ws => termWss.emit('connection', ws, req));
    } else if (req.url.startsWith('/ws/code')) {
      codeWss.handleUpgrade(req, socket, head, ws => codeWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  // ─── Main terminal ──────────────────────────────────────────────────────────
  termWss.on('connection', (ws) => {
    const ptyMod = getPty();
    if (!ptyMod) {
      ws.send(JSON.stringify({ type: 'output', data: '\r\nnode-pty is not installed.\r\nInstall it from Settings → System Tools, then reopen this terminal.\r\n' }));
      ws.close();
      return;
    }

    const shell = process.env.SHELL || '/bin/bash';
    let ptyProc;
    try {
      ptyProc = ptyMod.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80, rows: 24,
        cwd: process.env.HOME || WORKSPACE_DIR,
        env: process.env
      });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'output', data: `\r\nFailed to spawn shell: ${e.message}\r\n` }));
      ws.close();
      return;
    }

    ptyProc.onData(data => {
      if (ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ type: 'output', data }));
    });

    ptyProc.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        ws.close();
      }
    });

    ws.on('message', raw => {
      try {
        const { type, data, cols, rows } = JSON.parse(raw.toString());
        if (type === 'input')  ptyProc.write(data);
        if (type === 'resize') ptyProc.resize(Math.max(2, cols), Math.max(2, rows));
      } catch {}
    });

    ws.on('close', () => { try { ptyProc.kill(); } catch {} });
  });

  // ─── Code tool terminals ────────────────────────────────────────────────────
  codeWss.on('connection', (ws) => {
    const ptyMod = getPty();
    if (!ptyMod) {
      ws.send(JSON.stringify({ type: 'output', data: '\r\nnode-pty not installed. Install it from Settings → System Tools, then reopen.\r\n' }));
      ws.close();
      return;
    }

    const shell = process.env.SHELL || '/bin/bash';
    let ptyProc;
    try {
      ptyProc = ptyMod.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80, rows: 20,
        cwd: process.env.HOME || WORKSPACE_DIR,
        env: process.env
      });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'output', data: `\r\nFailed to spawn shell: ${e.message}\r\n` }));
      ws.close();
      return;
    }

    ptyProc.onData(data => {
      if (ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ type: 'output', data }));
    });

    ptyProc.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        ws.close();
      }
    });

    ws.on('message', raw => {
      try {
        const { type, data, cols, rows } = JSON.parse(raw.toString());
        if (type === 'input')  ptyProc.write(data);
        if (type === 'resize') ptyProc.resize(Math.max(2, cols), Math.max(2, rows));
      } catch {}
    });

    ws.on('close', () => { try { ptyProc.kill(); } catch {} });
  });
}

module.exports = { setup };
