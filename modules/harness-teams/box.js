'use strict';

/**
 * The computer side of an outside worker (harness-teams/): everything happens inside its agents' computer (computers/),
 * reached with `docker exec` and `docker cp` by argv — never a shell string with a task or a name in it.
 *
 *   install   the CLI from its catalog installCmd's npm package, into the computer's own home (~/.npm-global, on its
 *             volume), so it is installed once per computer and never on the hub — or a Python one (`team.uv`) with uv,
 *             itself put in ~/.local/bin by its own installer the first time
 *   project   the project's HEAD (or the branch of the task before) goes in as a git bundle and is cloned into ~/teams/<worker>, on the worker's branch
 *   run       the CLI in that folder, in a process group of its own whose id is kept in a file, so Stop ends it whole
 *   pull      what it committed comes back as a bundle of base..branch, fetched into the project's repository on the hub
 *             as the same branch — the hub's working tree and checked-out branch are never touched
 *
 * The API key, when DOCA keeps one, is put in the docker client's environment and named with `-e NAME` alone: Docker
 * reads the value from there, so it is in no argument, no log and no record — only that one process's environment.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const HOME = '/home/agent';
const BIN = `${HOME}/.npm-global/bin`;
const LOCAL_BIN = `${HOME}/.local/bin`;   // uv and the Python CLIs it installs (team.uv)
const PATH_IN = `${BIN}:${LOCAL_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const name = c => `doca-computer-${c.id}`;
const cli = () => require('../containers').cli();
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** Docker's own environment plus the secrets this call carries (named in argv by `-e NAME` only). */
function envFlags(env = {}) {
  const flags = [], vars = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) continue;
    flags.push('-e', k); vars[k] = String(v);
  }
  return { flags, vars };
}

/** Run argv in the computer. Resolves {code, stdout, stderr}; never rejects for a non-zero exit. */
function exec(c, argv, { user = 'agent', cwd = null, env = {}, timeout = 120000 } = {}) {
  const { flags, vars } = envFlags({ PATH: PATH_IN, HOME, ...env });
  const args = ['exec', '-u', user, ...(cwd ? ['-w', cwd] : []), ...flags, name(c), ...argv];
  return new Promise(resolve => {
    execFile(cli(), args, { timeout, maxBuffer: 16 << 20, windowsHide: true, env: { ...process.env, ...vars } }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

const must = async (c, argv, opts) => {
  const r = await exec(c, argv, opts);
  if (r.code !== 0) throw bad(`${argv.slice(0, 3).join(' ')} in ${c.name}: ${(r.stderr || r.stdout).trim().split('\n').pop() || `exit ${r.code}`}`, 500);
  return r.stdout;
};

function docker(args, timeout = 120000) {
  return new Promise((resolve, reject) => execFile(cli(), args, { timeout, maxBuffer: 8 << 20, windowsHide: true },
    (err, stdout, stderr) => (err ? reject(bad(String(stderr || err.message).trim().split('\n').pop(), 500)) : resolve(String(stdout)))));
}

/** A package file on the hub (an offline or test package) copied into the computer; returns its path there. */
async function copyIn(c, file) {
  const spec = `/tmp/${path.basename(file)}`;
  await docker(['cp', file, `${name(c)}:${spec}`]);
  await exec(c, ['chown', 'agent:agent', spec], { user: '0' });
  return spec;
}

/** A Python CLI (`team.uv`) in the computer: uv first when it has none (astral's installer, into ~/.local/bin), then `uv tool install`. */
async function installUv(c, row) {
  const bin = `${LOCAL_BIN}/${row.cmd}`;
  if ((await exec(c, ['test', '-x', bin])).code === 0) return { bin, installed: false };
  const pkg = String(row.team.uv);
  let spec = pkg;
  if (path.isAbsolute(pkg) && fs.existsSync(pkg)) spec = await copyIn(c, pkg);
  else if (!/^[A-Za-z0-9][\w.-]*(==[\w.]+)?$/.test(pkg)) throw bad(`Not a Python package name: ${pkg}`);
  const uv = `${LOCAL_BIN}/uv`;
  if ((await exec(c, ['test', '-x', uv])).code !== 0) {
    // uv's documented installer; where it goes is an argument ($0), never spliced into the script.
    await must(c, ['sh', '-c', 'curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$0" UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 sh', LOCAL_BIN], { timeout: 10 * 60000 });
  }
  await must(c, [uv, 'tool', 'install', '--quiet', spec], { timeout: 15 * 60000, env: { UV_TOOL_BIN_DIR: LOCAL_BIN } });
  if ((await exec(c, ['test', '-x', bin])).code !== 0) throw bad(`${pkg} installed, but it has no ${row.cmd} command.`, 500);
  return { bin, installed: true };
}

/** The CLI in the computer: installed already, else from its npm package (a package file on the hub is copied in first). */
async function install(c, row) {
  if (row.team?.uv) return installUv(c, row);
  const bin = `${BIN}/${row.cmd}`;
  if ((await exec(c, ['test', '-x', bin])).code === 0) return { bin, installed: false };
  const pkg = require('./harnesses').npmPackage(row);
  if (!pkg) throw bad(`${row.label} is not installed with npm, so DOCA cannot put it in a computer by itself.`, 409);
  let spec = pkg;
  if (path.isAbsolute(pkg) && fs.existsSync(pkg)) spec = await copyIn(c, pkg);   // an offline or test package: copied in, then installed from there
  else if (!/^[@\w./:-]+$/.test(pkg)) throw bad(`Not an npm package name: ${pkg}`);
  await must(c, ['npm', 'install', '-g', '--prefix', `${HOME}/.npm-global`, '--no-fund', '--no-audit', spec], { timeout: 15 * 60000 });
  if ((await exec(c, ['test', '-x', bin])).code !== 0) throw bad(`${pkg} installed, but it has no ${row.cmd} command.`, 500);
  return { bin, installed: true };
}

/** Whether the CLI says it is signed in by itself (a person's sign-in kept in this computer's home). */
async function signedIn(c, row, bin) {
  if (!Array.isArray(row.team?.signedIn)) return null;   // it has no way to say: the run will tell
  return (await exec(c, [bin, ...row.team.signedIn], { cwd: HOME, timeout: 30000 })).code === 0;
}

/** The project at `from` (HEAD, or the branch of the task before) into ~/teams/<worker>, on `branch`. Returns {dir, base}. */
async function putProject(c, { root, worker, branch, author, from = 'HEAD' }) {
  const git = require('../projects/git').git;
  if (!/^(?!-)[\w./-]{1,120}$/.test(String(from))) throw bad(`Not a ref to start from: ${from}`);
  const base = (await git(root, ['rev-parse', '--verify', `${from}^{commit}`])).trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-team-'));
  const bundle = `/tmp/doca-${worker}.bundle`, dir = `${HOME}/teams/${worker}`;
  try {
    await git(root, ['bundle', 'create', path.join(tmp, 'p.bundle'), from], { timeout: 300000 });   // HEAD or a branch: a bundle carries refs
    await docker(['cp', path.join(tmp, 'p.bundle'), `${name(c)}:${bundle}`], 300000);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  await exec(c, ['chown', 'agent:agent', bundle], { user: '0' });
  await exec(c, ['rm', '-rf', dir]);
  await must(c, ['mkdir', '-p', `${HOME}/teams`]);
  await must(c, ['git', 'clone', '-q', '--no-checkout', bundle, dir], { timeout: 300000 });
  await must(c, ['git', 'checkout', '-q', '-b', branch, base], { cwd: dir });
  await must(c, ['git', 'config', 'user.name', author], { cwd: dir });
  await must(c, ['git', 'config', 'user.email', 'team-worker@doca.local'], { cwd: dir });
  await exec(c, ['rm', '-f', bundle]);
  return { dir, base };
}

/** The CLI at work: a child process streaming its stdout; its process group id goes in `pidfile` for Stop. */
function run(c, { dir, bin, args, env = {}, pidfile }) {
  const { flags, vars } = envFlags({ PATH: PATH_IN, HOME, CI: '1', NO_COLOR: '1', TERM: 'dumb', ...env });
  const argv = ['exec', '-u', 'agent', '-w', dir, ...flags, name(c), 'setsid', '-w', 'sh', '-c', 'echo $$ > "$0"; exec "$@"', pidfile, bin, ...args];
  return spawn(cli(), argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...vars } });
}

/** End the CLI and everything it started: TERM to its process group, then KILL what is left (procps kill: dash's own reads "-PGID" as a bad number). */
function kill(c, pidfile) {
  return exec(c, ['sh', '-c', 'p=$(cat "$0" 2>/dev/null) || exit 0; /bin/kill -TERM -- "-$p" 2>/dev/null || exit 0; sleep 4; /bin/kill -KILL -- "-$p" 2>/dev/null; true', pidfile], { timeout: 30000 });
}

/** A small text file into the computer (the team's notes for a worker), by docker cp — never through a shell. */
async function write(c, file, text) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-team-'));
  try {
    fs.writeFileSync(path.join(tmp, 'f'), text);
    await docker(['cp', path.join(tmp, 'f'), `${name(c)}:${file}`]);
    await exec(c, ['chown', 'agent:agent', file], { user: '0' });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function read(c, file) { const r = await exec(c, ['cat', file]); return r.code === 0 ? r.stdout : ''; }

async function head(c, dir) { const r = await exec(c, ['git', 'rev-parse', 'HEAD'], { cwd: dir }); return r.code === 0 ? r.stdout.trim() : null; }

/** What it changed and did not commit, committed for it (said so in the message), so the branch holds all of it. */
async function commitLeftovers(c, dir, label) {
  const st = await exec(c, ['git', 'status', '--porcelain'], { cwd: dir });
  if (st.code !== 0 || !st.stdout.trim()) return false;
  await must(c, ['git', 'add', '-A'], { cwd: dir });
  await must(c, ['git', 'commit', '-q', '-m', `Work ${label} left uncommitted when it ended (committed by DOCA)`], { cwd: dir });
  return true;
}

/**
 * Its commits since `base` into the hub's repository as `branch`. Returns {head, commits} or null when there is
 * nothing new. A branch checked out in a worktree on the hub is refused by git, and said.
 */
async function pull(c, { dir, branch, base, root, worker }) {
  const count = await exec(c, ['git', 'rev-list', '--count', `${base}..HEAD`], { cwd: dir });
  const n = Number(count.stdout.trim()) || 0;
  if (count.code !== 0 || !n) return null;
  const inside = `/tmp/doca-out-${worker}.bundle`;
  await must(c, ['git', 'bundle', 'create', '-q', inside, `${base}..${branch}`], { cwd: dir, timeout: 300000 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-team-'));
  try {
    await docker(['cp', `${name(c)}:${inside}`, path.join(tmp, 'out.bundle')], 300000);
    await require('../projects/git').git(root, ['fetch', '-q', path.join(tmp, 'out.bundle'), `+refs/heads/${branch}:refs/heads/${branch}`], { timeout: 300000 });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); await exec(c, ['rm', '-f', inside]); }
  return { head: (await head(c, dir)), commits: n };
}

module.exports = { exec, install, signedIn, putProject, run, kill, write, read, head, commitLeftovers, pull, name, HOME, BIN };
