'use strict';

/**
 * Who may connect to the panel at all.
 *
 * The panel has no login yet, and `/api/*` runs shell commands, manages
 * containers and VMs, and writes files — so until authentication exists, the
 * network is the only thing standing in front of it. It used to answer on every
 * interface, which put all of that one Wi-Fi password away from anybody.
 *
 * It still *listens* on every interface. What it refuses is any connection that
 * did not arrive on loopback or on the tailnet, decided per connection from the
 * address the client dialled and the address it came from. Binding to the
 * Tailscale address instead would be simpler and worse: that address can be
 * missing when the panel starts (tailscaled up late) or vanish while it runs —
 * it did, on 2026-09-25 — and a panel bound to an address that is not there
 * is unreachable until somebody restarts it by hand.
 *
 * Modes, from `DOCA_LISTEN` or prefs `network.listen`:
 *   tailnet  loopback + Tailscale (100.64.0.0/10, fd7a:115c:a1e0::/48) — the default
 *   local    loopback only; reach it through `tailscale serve` or an SSH tunnel
 *   all      every interface, as before; an explicit, logged opt-in
 */
const MODES = ['tailnet', 'local', 'all'];
const DEFAULT = 'tailnet';

/** `::ffff:1.2.3.4` is an IPv4 client on a dual-stack socket. */
function plain(addr) {
  return String(addr || '').replace(/^::ffff:/i, '');
}

function isLoopback(addr) {
  const a = plain(addr);
  return a === '::1' || /^127\./.test(a);
}

function isTailnet(addr) {
  const a = plain(addr).toLowerCase();
  const v4 = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) return Number(v4[1]) === 100 && Number(v4[2]) >= 64 && Number(v4[2]) <= 127;   // 100.64.0.0/10
  return a.startsWith('fd7a:115c:a1e0:');
}

/**
 * Whether one connection may proceed. Both ends are checked: the address it
 * reached must be loopback or tailnet, and the peer must be on the same side of
 * that line — a LAN host that routed a packet at this machine's 100.x address
 * reached a tailnet address without being on the tailnet.
 */
function allowed(mode, localAddress, remoteAddress) {
  if (mode === 'all') return true;
  if (isLoopback(localAddress)) return isLoopback(remoteAddress);
  if (mode === 'tailnet' && isTailnet(localAddress)) return isTailnet(remoteAddress);
  return false;
}

/** The mode in force: environment, then prefs, then the default. */
function mode(prefs = {}) {
  const asked = String(process.env.DOCA_LISTEN || prefs.network?.listen || DEFAULT).trim().toLowerCase();
  if (MODES.includes(asked)) return asked;
  console.warn(`[listen] unknown mode "${asked}" — using "${DEFAULT}". Valid: ${MODES.join(', ')}.`);
  return DEFAULT;
}

/**
 * Refuse, at the socket, every connection the mode does not allow — before TLS,
 * before Express, and for WebSocket upgrades too, since they arrive on the same
 * sockets. Each refused address is logged once, so "the panel does not load
 * from my laptop" has an answer in the log rather than a silent reset.
 */
function guard(server, m) {
  if (m === 'all') {
    console.warn('[listen] mode "all": every interface is accepted, and the panel has no login.');
    return;
  }
  const told = new Set();
  // Prepended: the server's own 'connection' handler was registered when it was
  // created, and it must never see a socket this one is about to drop.
  server.prependListener('connection', socket => {
    if (allowed(m, socket.localAddress, socket.remoteAddress)) return;
    const who = plain(socket.remoteAddress);
    if (!told.has(who) && told.size < 100) {
      told.add(who);
      console.warn(`[listen] refused ${who} → ${plain(socket.localAddress)} (mode "${m}"; set DOCA_LISTEN=all to allow every network)`);
    }
    socket.destroy();
  });
}

/**
 * Guard, then bind, tolerating a predecessor that has not finished shutting
 * down. POST /api/restart spawns its successor *before* exiting, so a short
 * burst of EADDRINUSE at startup is expected rather than fatal.
 */
const BIND_RETRY_MS = 20000;
function start(server, { port, mode: m, name, announce }) {
  guard(server, m);
  const deadline = Date.now() + BIND_RETRY_MS;
  let bound  = false;
  let waited = false;

  server.on('listening', () => { bound = true; announce(); });
  server.on('error', err => {
    if (bound || err.code !== 'EADDRINUSE') {
      console.error(`[server] ${err.message}`);
      process.exit(1);
    }
    if (Date.now() >= deadline) {
      console.error(`[server] port ${port} is still in use after ${Math.round(BIND_RETRY_MS / 1000)}s — another ${name} is probably already running.`);
      process.exit(1);
    }
    if (!waited) {
      waited = true;
      console.log(`[server] port ${port} busy — waiting for the previous instance to exit…`);
    }
    setTimeout(() => server.listen(port, '0.0.0.0'), 250);
  });

  server.listen(port, '0.0.0.0');
}

module.exports = { MODES, DEFAULT, mode, allowed, guard, start, isLoopback, isTailnet };
