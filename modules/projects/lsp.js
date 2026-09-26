'use strict';

/**
 * Code intelligence for the Projects editor: language servers, bridged.
 *
 * The editor (public/js/projects/lsp.js) speaks the Language Server Protocol
 * over a WebSocket at /ws/lsp?project=<id>&server=<name>; this starts that
 * language server in the project's root and relays JSON-RPC between the two,
 * adding and stripping the Content-Length framing stdio uses. One server
 * process per open socket; it ends when the socket does. Behind the same gate
 * as the terminal (the host right, a recent sign-in, the panel's own page).
 *
 * Opt-in: a server is used when it is on this machine. The npm-based ones
 * (TypeScript/JavaScript, Python) can be installed into DOCA's data folder —
 * no sudo, nothing global — from the Projects tab. The rest are used when
 * installed the usual way (gopls, rust-analyzer, clangd, …).
 */
const fs   = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const store = require('../store');
const shell = require('../shell');

/** Language servers: which editor languages each serves, how it starts, and how it installs here. */
const SERVERS = {
  typescript: { label: 'TypeScript / JavaScript', langs: ['typescript', 'javascript'], bin: 'typescript-language-server', args: ['--stdio'],
    // typescript@7 is the native (Go) compiler and has no tsserver.js, which this server drives: the last JS line.
    npm: ['typescript-language-server', 'typescript@<7'],
    // It looks for TypeScript only in the workspace: the project's own when it has one (same version as its build), else the one installed beside it.
    init: root => {
      const own = path.join(root, 'node_modules', 'typescript', 'lib', 'tsserver.js');
      const ours = path.join(localDir(), 'node_modules', 'typescript', 'lib', 'tsserver.js');
      const use = fs.existsSync(own) ? own : fs.existsSync(ours) ? ours : null;
      return use ? { tsserver: { path: use } } : null;
    } },
  python:     { label: 'Python (Pyright)', langs: ['python'], bin: 'pyright-langserver', args: ['--stdio'], npm: ['pyright'] },
  go:         { label: 'Go (gopls)', langs: ['go'], bin: 'gopls', args: [] },
  rust:       { label: 'Rust (rust-analyzer)', langs: ['rust'], bin: 'rust-analyzer', args: [] },
  c:          { label: 'C / C++ (clangd)', langs: ['c', 'cpp'], bin: 'clangd', args: [] },
  kotlin:     { label: 'Kotlin', langs: ['kotlin'], bin: 'kotlin-language-server', args: [] },
  java:       { label: 'Java (jdtls)', langs: ['java'], bin: 'jdtls', args: [] },
};

const localDir = () => store.dir('lsp');

/** The server's binary: DOCA's own install first, then PATH. */
function binOf(name) {
  const s = SERVERS[name];
  if (!s) return null;
  const local = path.join(localDir(), 'node_modules', '.bin', s.bin + (process.platform === 'win32' ? '.cmd' : ''));
  if (fs.existsSync(local)) return local;
  if (path.isAbsolute(s.bin)) return fs.existsSync(s.bin) ? s.bin : null;
  return shell.which(s.bin);
}

/** Every server: found, where, and whether it can be installed here. */
function status() {
  return Object.entries(SERVERS).map(([name, s]) => {
    const bin = binOf(name);
    return { name, label: s.label, langs: s.langs, found: !!bin, bin: bin || null, installable: !!s.npm };
  });
}

/** Install an npm-based server into the data folder. Resolves with the end of npm's output. */
function install(name) {
  const s = SERVERS[name];
  if (!s?.npm) return Promise.reject(Object.assign(new Error(`${name} is not installed from here; install it the usual way for your system.`), { status: 400 }));
  const npm = shell.which('npm');
  if (!npm) return Promise.reject(Object.assign(new Error('npm is not on this machine.'), { status: 501 }));
  fs.mkdirSync(localDir(), { recursive: true });
  if (!fs.existsSync(path.join(localDir(), 'package.json'))) fs.writeFileSync(path.join(localDir(), 'package.json'), '{"private":true}\n');
  return new Promise((resolve, reject) => {
    execFile(npm, ['install', '--no-audit', '--no-fund', '--prefix', localDir(), ...s.npm], { timeout: 10 * 60e3, maxBuffer: 16 << 20 },
      (err, out, errOut) => (err ? reject(Object.assign(new Error(String(errOut || err.message).trim().split('\n').slice(-3).join(' ')), { status: 500 }))
        : resolve({ name, found: !!binOf(name), output: String(out).trim().split('\n').slice(-5).join('\n') })));
  });
}

/** stdout of a language server → whole JSON-RPC messages. */
function framer(onMessage) {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const head = buf.indexOf('\r\n\r\n');
      if (head < 0) return;
      const m = /Content-Length:\s*(\d+)/i.exec(buf.subarray(0, head).toString('ascii'));
      if (!m) { buf = buf.subarray(head + 4); continue; }
      const len = Number(m[1]), start = head + 4;
      if (buf.length < start + len) return;
      onMessage(buf.subarray(start, start + len).toString('utf8'));
      buf = buf.subarray(start + len);
    }
  };
}

const frame = json => { const b = Buffer.from(json, 'utf8'); return Buffer.concat([Buffer.from(`Content-Length: ${b.length}\r\n\r\n`, 'ascii'), b]); };

let _wss = null;

/** A WebSocket upgrade at /ws/lsp (routed by terminal.setup, which has checked the gate). */
function upgrade(req, socket, head) {
  const u = new URL(req.url, 'http://x');
  const p = require('./store').get(u.searchParams.get('project'));
  const name = u.searchParams.get('server');
  const bin = p && binOf(name);
  if (!p || !bin) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
  if (!_wss) _wss = new (require('ws').WebSocketServer)({ noServer: true });
  _wss.handleUpgrade(req, socket, head, ws => {
    const child = spawn(bin, SERVERS[name].args, { cwd: p.root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', framer(msg => { try { ws.send(msg); } catch { /* closed */ } }));
    child.stderr.on('data', () => { /* servers log to stderr; not the editor's business */ });
    child.on('exit', () => { try { ws.close(); } catch { /* already */ } });
    child.on('error', () => { try { ws.close(1011, 'the language server did not start'); } catch { /* already */ } });
    ws.on('message', data => {
      let text = String(data);
      // The server's own start-up options (e.g. where TypeScript is), added to the editor's initialize.
      if (SERVERS[name].init && text.includes('"initialize"')) {
        try {
          const m = JSON.parse(text);
          const opts = m.method === 'initialize' && SERVERS[name].init(p.root);
          if (opts) { m.params = { ...m.params, initializationOptions: { ...opts, ...(m.params?.initializationOptions || {}) } }; text = JSON.stringify(m); }
        } catch { /* not JSON: pass it on as it is */ }
      }
      try { child.stdin.write(frame(text)); } catch { /* exited */ }
    });
    ws.on('close', () => { try { child.kill(); } catch { /* gone */ } });
  });
}

module.exports = { SERVERS, status, install, upgrade, binOf, framer, frame };
