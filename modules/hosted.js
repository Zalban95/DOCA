'use strict';

/**
 * The hosted profile (`DOCA_PROFILE=hosted`, set by the image and the deploy kit — deploy/README.md): a hive whose
 * own machine is not its tenant's. A customer's hive on a provider's server, or a demo hive beside the owner's, runs
 * DOCA's code; nobody using it — nor its agents — may read that code or act on the machine it runs on. Work happens
 * in the workspace, in the agents' computers and on the person's paired devices.
 *
 * Read once, here, from the environment at start: never a setting, so no person in the panel and no agent can turn
 * it off. With no profile (every install made by scripts/install.*) nothing here changes anything.
 *
 * What it takes away is listed in one place — `ROUTES`, `SOCKETS`, `TOOLS`, `TABS`, `COMMANDS`, `INSTALL_KINDS` —
 * and is absent rather than refused: the routes answer the panel's own 404 before any handler runs, the tools are
 * not in the agent's list at all, the tabs are not drawn. Beside that, every path the file tools, the Files routes
 * and the Projects editor may open is the workspace (`roots()`), and nothing under the code's folder (`inApp`).
 * test/hosted-profile.test.js holds it.
 */
const fs = require('fs');
const path = require('path');

const PROFILE = String(process.env.DOCA_PROFILE || '').trim().toLowerCase();
const HOSTED = PROFILE === 'hosted';
const on = () => HOSTED;

// The folder the running code is in (this file's parent's parent), by its real path.
const APP_DIR = (() => { const d = path.resolve(__dirname, '..'); try { return fs.realpathSync.native(d); } catch { return d; } })();

const SAY = 'This hive is hosted: the machine it runs on is not part of it. Work in the workspace, in an agents\' '
  + 'computer, or on one of your paired devices.';

/** A refusal for something a code path still reached (a stdio MCP server, a command line): an Error with status 404. */
function refusal(what) {
  return Object.assign(new Error(`${what} is not part of a hosted hive. ${SAY}`), { status: 404, code: 'not_found' });
}

const sep = path.sep;
const fold = s => (process.platform === 'win32' ? s.toLowerCase() : s);
const under = (p, dir) => { const a = fold(p), d = fold(dir); return a === d || a.startsWith(d.endsWith(sep) ? d : d + sep); };

/** Whether a real path is the code's folder or inside it — or holds it (a root of `/` would). */
function inApp(real) {
  if (!HOSTED || !real) return false;
  return under(real, APP_DIR) || under(APP_DIR, real);
}

/**
 * The folders the file tools, the Files routes and the Projects editor may open in a hosted hive: the workspace and
 * the attachments and specialists folders when they are elsewhere — never one holding the code (paths.js asks this
 * instead of its per-OS list). Given by the deploy's environment (Dockerfile), which wins over a saved path.
 */
function roots(env = process.env, home = require('os').homedir()) {
  const ws = env.WORKSPACE_DIR || path.join(home, '.openclaw', 'workspace');
  const list = [ws, env.ATTACHMENTS_DIR, env.AGENTS_DIR].filter(Boolean).map(p => path.resolve(p));
  const real = p => { try { return fs.realpathSync.native(p); } catch { return p; } };
  return [...new Set(list)].filter(p => !under(real(p), APP_DIR) && !under(APP_DIR, real(p)));
}

/* ── What a hosted hive does not have ──────────────────── */

// [method or '*', path pattern]: answered as absent before the gate and any handler. Each group says why.
const ROUTES = [
  // The hub machine's own files and shell: the Files tab's machine list (its read/write routes stay, inside roots()),
  // the config files and scripts on it, snapshots (bash on a script), paths (the deploy's).
  ['*', /^\/api\/files\/(roots|mounts)$/],
  ['*', /^\/api\/configs(\/|$)/],
  ['*', /^\/api\/setup\/scripts(\/|$)/],
  ['*', /^\/api\/snapshots(\/|$)/],
  ['POST', /^\/api\/paths(\/create)?$/],
  // Installing onto the machine: System tools, CLI harnesses, custom harnesses, model tools, OpenClaw's skills hub.
  ['*', /^\/api\/system\/tools(\/|$)/],
  ['POST', /^\/api\/harness\/custom$/], ['DELETE', /^\/api\/harness\/custom\/[^/]+$/],
  ['POST', /^\/api\/harness\/[^/]+\/install$/],
  ['POST', /^\/api\/harness\/(?!doca\/)[^/]+\/config$/],
  ['*', /^\/api\/harness\/opendots\/(config|stack)$/],
  ['POST', /^\/api\/models\/tools\/[^/]+\/(install|config)$/],
  ['POST', /^\/api\/models\/local\/(install|delete)$/],
  ['POST', /^\/api\/models\/hf\/(download|delete)$/],
  ['POST', /^\/api\/skills\/install$/], ['GET', /^\/api\/skills\/search$/],
  // The machine's programs: the OpenClaw stack, Docker, inference services, llama.cpp servers, VMs, start at boot.
  ['*', /^\/api\/(action|stack\/update|stack\/info)$/],
  ['*', /^\/api\/docker(\/|$)/],
  ['*', /^\/api\/services\/(start|stop|settings)$/],
  ['*', /^\/api\/models\/llamacpp(\/|$)/],
  ['*', /^\/api\/vms(\/|$)/],
  ['*', /^\/api\/startup$/],
  // The code itself: updating from git and switching versions.
  ['*', /^\/api\/(update|deps)$/],
  ['*', /^\/api\/versions(\/|$)/],
  // Commands a device console's buttons run on the machine; DOCA's apps built from a folder on it (Gradle runs it);
  // trainers and services DOCA would set up and run here (Python).
  ['PUT', /^\/api\/devices\/[^/]+\/console(\/buttons)?$/],
  ['POST', /^\/api\/clients\/apps\/[^/]+\/(repo|build)$/],
  ['POST', /^\/api\/wakeword\/(setup|train|stop)$/],
  ['POST', /^\/api\/system-one\/(setup|setup\/stop|start|stop)$/],
  // Projects' commands, environments, git and language servers run programs on the machine.
  ['*', /^\/api\/projects\/[^/]+\/(run|jobs\/.*|env\/setup|git\/.*)$/],
  ['*', /^\/api\/projects\/lsp(\/|$)/],
];

// WebSocket paths the upgrade router (terminal.js) refuses: a shell, a CLI harness's terminal, a language server, a VM.
const SOCKETS = [/^\/ws\/terminal/, /^\/ws\/harness/, /^\/ws\/lsp/, /^\/ws\/vm\//];

// The agent's tools that run a command line on the machine, or run git on its files.
const TOOLS = ['shell', 'shell_job', 'hub_command', 'git'];

// The panel's pages that are the machine itself (nav.js leaves them out).
const TABS = ['terminal', 'files', 'docker', 'vms'];

// The hub commands a device or the agent may run (api-v1/commands.js) that act on the machine's programs.
const COMMANDS = /^(compose|docker|services|llamacpp|snapshots)\./;

// What install_propose may install here: only what reaches another machine (an Ollama model pulled over the network).
const INSTALL_KINDS = ['ollama-model'];

/**
 * The container's default gateway (`/proc/net/route`), read once: in a hosted hive it is the machine whose port was
 * published — the deploy binds that port to its loopback or tailnet (deploy/hive.sh), so a request from it came
 * through the door the deploy chose. network.js counts it as the machine itself, as it counts loopback; anything
 * else on the container's network is still outside. Null outside a container, outside Linux or with no default route.
 */
function parseGateway(table) {
  const row = String(table || '').split('\n').slice(1).map(l => l.trim().split(/\s+/)).find(c => c[1] === '00000000' && /^[0-9A-F]{8}$/i.test(c[2] || ''));
  return row ? [6, 4, 2, 0].map(i => parseInt(row[2].slice(i, i + 2), 16)).join('.') : null;
}
let _gw;
function gateway() {
  if (_gw !== undefined) return _gw;
  _gw = null;
  if (!['/.dockerenv', '/run/.containerenv'].some(f => fs.existsSync(f))) return _gw;
  try { _gw = parseGateway(fs.readFileSync('/proc/net/route', 'utf8')); } catch { /* not Linux */ }
  return _gw;
}
const fromHost = addr => HOSTED && !!gateway() && String(addr || '').replace(/^::ffff:/i, '') === gateway();

const absentRoute = (method, p) => HOSTED && ROUTES.some(([m, re]) => (m === '*' || m === method) && re.test(p));

/** Express middleware, mounted first: an absent route is the panel's own 404, before the gate and any handler. */
function middleware(req, res, next) {
  if (!absentRoute(req.method, req.path)) return next();
  res.status(404).json({ code: 'not_found', error: `There is no ${req.method} ${req.path} in this panel.`, hosted: true });
}

/**
 * The panel's page, told it is a hosted hive before any script runs (`window.DOCA_HOSTED`), so the pages that would
 * ask for an absent route (the sidebar's llama.cpp servers, Controls' containers) do not: mounted just before the
 * static files, after the gate. Every other install gets the file as it is.
 */
let _page = null;
function page(req, res, next) {
  if (!HOSTED || req.method !== 'GET' || !['/', '/index.html'].includes(req.path)) return next();
  if (!_page) _page = fs.readFileSync(path.join(APP_DIR, 'public', 'index.html'), 'utf8').replace('<head>', '<head><script>window.DOCA_HOSTED = true; document.documentElement.dataset.hosted = "1";</script>');
  res.type('html').setHeader('Cache-Control', 'no-cache');
  res.send(_page);
}

const absentSocket = url => HOSTED && SOCKETS.some(re => re.test(String(url || '')));
const absentTool = name => HOSTED && TOOLS.includes(name);

module.exports = { PROFILE, on, APP_DIR, SAY, refusal, inApp, roots, ROUTES, SOCKETS, TOOLS, TABS, COMMANDS, INSTALL_KINDS,
  absentRoute, middleware, page, absentSocket, absentTool, parseGateway, gateway, fromHost };
