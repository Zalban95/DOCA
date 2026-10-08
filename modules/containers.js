'use strict';

/**
 * Which container CLI this host has (TODO H1.6; hive.md §7): `docker` — Docker Engine on Linux, Docker Desktop on
 * Windows and macOS, Colima or OrbStack behind the same CLI — else `podman`, whose CLI takes the same arguments for
 * everything DOCA runs (run, ps, exec, cp, logs, pull, `--format` Go templates, `compose` through its provider).
 * `DOCA_CONTAINER_CLI` names one outright. Looked up on use, so installing one needs no restart.
 */
let _cache = null;

function cli() {
  if (process.env.DOCA_CONTAINER_CLI) return process.env.DOCA_CONTAINER_CLI;
  if (_cache && Date.now() - _cache.at < 60000) return _cache.name;
  const { which } = require('./shell');
  const name = which('docker') ? 'docker' : which('podman') ? 'podman' : 'docker';   // nothing: docker, whose "not found" is the message people search for
  _cache = { at: Date.now(), name };
  return name;
}

/**
 * The containers, as `ps` describes them: one parsed object per line of `--format '{{json .}}'`, by argv (no shell, so
 * the braces need no quoting on Windows either). `all` adds the stopped ones. Rejects with the CLI's own error, which
 * docker.js reads to tell "not installed" and "daemon stopped" apart. The one reader for the sidebar's status, the
 * Docker tab and the machines' rows (machines/rows.js).
 */
function ps({ all = false } = {}) {
  return new Promise((resolve, reject) => require('child_process').execFile(cli(), ['ps', ...(all ? ['-a'] : []), '--format', '{{json .}}'],
    { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr }));
      resolve(String(stdout).trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
    }));
}

module.exports = { cli, ps, _reset: () => { _cache = null; } };
