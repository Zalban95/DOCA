'use strict';

/**
 * How a running container came up when no line of DOCA's says (origin.js): Docker's own restart policy. After a reboot
 * Docker starts every container whose policy is `always` / `unless-stopped`, and one that keeps failing is restarted
 * again and again — and none of that passes through DOCA, so it read "started outside DOCA", in amber, on DOCA's own
 * services (audit 2026-10-17: the machine rebooted at 00:47 and every row said so). `docker inspect` says it exactly:
 * when it started, its policy and how many times Docker restarted it.
 *
 * `read(names)` asks once for every running container (one `inspect` by argv), kept per container until its start time
 * changes and asked again at most every ASK_MS; `phrase(name)` is synchronous for origin.of. Mechanical: fixed words.
 */
const os = require('os');
const ASK_MS = 60000;
const BOOT_WINDOW_MS = 10 * 60000;   // Docker brings policy containers up within minutes of boot (a GPU waits longer)
const POLICIES = /^(always|unless-stopped|on-failure)/;
const facts = new Map();             // name → { startedAt, policy, restarts }
let askedAt = 0, asking = null;

/** Read the facts of these running containers (names), at most every ASK_MS. Never throws. */
function read(names) {
  const want = [...new Set(names.filter(Boolean))];
  if (!want.length || (Date.now() - askedAt < ASK_MS && want.every(n => facts.has(n)))) return Promise.resolve();
  if (asking) return asking;
  askedAt = Date.now();
  const fmt = '{{.Name}}\t{{.State.StartedAt}}\t{{.HostConfig.RestartPolicy.Name}}\t{{.RestartCount}}';
  asking = new Promise(resolve => require('child_process').execFile(require('../containers').cli(), ['inspect', '--format', fmt, ...want],
    { timeout: 8000, maxBuffer: 1 << 20 }, (err, stdout) => {
      for (const line of String(stdout || '').split('\n')) {   // a container gone meanwhile fails the call but not the others' lines
        const [name, startedAt, policy, restarts] = line.split('\t');
        if (name && startedAt) facts.set(name.replace(/^\//, ''), { startedAt, policy, restarts: Number(restarts) || 0 });
      }
      asking = null; resolve();
    }));
  return asking;
}

/**
 * Docker's part in this container's start, or null: restarted by its policy (it failed), or started by it when the
 * machine started. `{ text, at, by: 'docker', outside: false }`.
 */
function phrase(name, now = Date.now(), uptimeSec = os.uptime()) {
  const f = facts.get(name);
  if (!f || !POLICIES.test(f.policy || '')) return null;
  const at = Date.parse(f.startedAt);
  if (!Number.isFinite(at)) return null;
  const boot = now - uptimeSec * 1000;
  const sinceBoot = at >= boot - 60000 && at - boot < BOOT_WINDOW_MS;
  if (f.restarts > 0) return { text: `restarted by Docker (its restart policy, ${f.restarts} time${f.restarts === 1 ? '' : 's'})`, at: f.startedAt, by: 'docker', outside: false };
  if (sinceBoot) return { text: 'started by Docker when this machine started (its restart policy)', at: f.startedAt, by: 'docker', outside: false };
  return null;
}

/** When this container last started, or null when unknown. */
const startedAt = name => facts.get(name)?.startedAt || null;

module.exports = { read, phrase, startedAt, _set: (name, f) => facts.set(name, f), _reset: () => { facts.clear(); askedAt = 0; asking = null; } };
