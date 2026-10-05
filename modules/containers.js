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

module.exports = { cli, _reset: () => { _cache = null; } };
