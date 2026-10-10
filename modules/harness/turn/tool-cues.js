'use strict';

/**
 * What a tool that is held but not loaded is for, and the words that say a request needs it (asked 2026-10-10: "does
 * the orchestrator organically reach everything, so it doesn't answer with a lesser option when a framework for the task
 * is already available?").
 *
 * Tools are sent by tier (tool-tiers.js): the rare ones are only named. A name alone did not say what it was for —
 * "Devices: secret_use, today, remind, screen, meeting" — so a request for the weather, a reminder or a lamp met no tool
 * it recognised and was answered with a shell, a raw request or a promise. Two parts, both mechanical (no model):
 *
 *   PURPOSE  a few words per tool, so the named list reads as "the job → the tool" (namedLine);
 *   CUES     the words of a request that need it: the tool is sent in full for that turn (split), and "Likely fits"
 *            says so (fits.js). Nothing is attached for the conversation until the agent calls it.
 *
 * MCP servers are read from their tools: a Home Assistant server (tools named Hass…) is "the home", and any server is
 * cued by its own name or label, or by its tools' names and descriptions matching the request.
 */
const { matcher } = require('../skill-match');

const PURPOSE = {
  remind: 'a reminder at a time, fired by itself',
  schedule: 'a job on a timetable (every day, each Monday…), proposed',
  today: 'weather, today\'s calendar, what waits for the person',
  canvas: 'a page beside the chat — a table, a chart, a preview of a local server',
  service: 'the API services set up here, by their actions (the hub sends the key)',
  library_search: 'the person\'s files found by what is in them — photos, recordings, documents',
  meeting: 'a call or meeting with people, proposed for the person to confirm',
  team: 'several specialists whose errands wait on each other',
  model_scout: 'newer models worth trying (what is trending)',
  machine_fit: 'which models this machine can run',
  hub_command: 'start, stop or restart the hub\'s services, containers, llama.cpp; snapshots',
  chronicle: 'what happened — past runs, missions, failures, costs, logs',
  memory_forget: 'forget a memory',
  memory_flag: 'mark a memory doubtful, keeping it',
  memory_rules_write: 'change the memory rules',
  secret_use: 'type or paste a kept secret (a password) on the person\'s device, unseen',
  screen: 'the screens and their pages; put a page on one',
  computer: 'a disposable Linux desktop: risky tries, a real browser, a demo',
  pack: 'package skills, recipes and specialists to move or share',
  mcp_draft: 'prepare an MCP server that is not in the catalogue',
  service_draft: 'prepare a web API that needs a key the person pastes',
  spend_propose: 'ask to be allowed to spend money',
  permission_grant: 'give a dispatched mission one more permission',
  mcp_status: 'the MCP servers, their state and tools',
  agent_resume: 'carry on or drop a paused mission',
  shell_job: 'a long command in the background (a dev server, a build)',
  replace_in_files: 'replace text across files',
  tool_note: 'a note on how a tool behaves on this install',
  features: 'everything this hub can do and where it is',
  computer_login: 'sign in on a computer\'s browser with a kept login',
  computer_look: 'what is on a computer\'s screen, and where',
  computer_next: 'the likeliest next element of a computer\'s page for a goal',
  vnc_look: 'see a VNC screen (another machine)',
  vnc_input: 'click and type on a VNC screen',
  http_fetch: 'read a web page',
  web_search: 'search the web',
  research_docs: 'read documentation through a reader',
  team_note: 'a note to your team\'s board',
};

// Built-in tools a request's words call for. Kept loose on purpose: a false cue costs one schema for one turn, a
// missed one costs the right tool.
const DAYS = 'day|morning|evening|night|week|weekday|weekend|hour|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const CUES = {
  remind: /\bremind(er|ers)?\b|\bricordami\b|\bpromemoria\b/i,
  schedule: new RegExp(`\\b(every|each)\\s+(\\d+\\s+)?(${DAYS})s?\\b|\\b(daily|weekly|monthly|nightly)\\b|\\bon a (schedule|timetable)\\b|\\bogni (giorno|mattina|sera|settimana|luned)`, 'i'),
  today: /\b(weather|forecast|rain(ing|y)?|snow(ing)?|umbrella|calendar|agenda|meteo|pioggia)\b|\bmy day\b/i,
  canvas: /\b(chart|graph|plot|diagram|dashboard)s?\b|\bbeside the chat\b|\bin a (page|window)\b|\bpreview\b|\bshow (it|me) (the )?(app|site|page)\b|\b(web ?app|dev server|website)\b/i,
  library_search: /\b(photos?|pictures?|images?|recordings?|recorded|videos?|footage|voice (notes?|memos?)|audio|clips?|scans?)\b|\bwhere (i|we) (talked|spoke|said|discussed|mentioned)\b|\bfoto\b/i,
  meeting: /\b(meetings?|video ?call|call with|meet with|conference call|invite)\b|\briunione\b/i,
  team: /\bfirst\b[^.?!]{0,200}\bthen\b|\bthen\b[^.?!]{0,200}\bthen\b|\bas a team\b/i,
  model_scout: /\b(newer|new|latest|trending|better|best)\b[^.?!]{0,40}\bmodels?\b|\bmodels?\b[^.?!]{0,40}\b(trending|newer|released)\b/i,
  machine_fit: /\bmodels?\b[^.?!]{0,60}\b(run|fit|this machine|locally|local|my gpu)\b|\b(run|fit)\b[^.?!]{0,40}\bmodels?\b|\blocal (llm|model)s?\b/i,
  hub_command: /\b(start|stop|restart|reboot|bring up|shut down)\b[^.?!]{0,60}\b(service|container|server|whisper|kokoro|llama|llama\.cpp|comfyui|vllm|ollama|stack)\b|\bsnapshot\b/i,
  chronicle: /\b(overnight|last night|yesterday|earlier today|what happened|happened while|logs?)\b|\b(did|has|have) (anything|something|it|they) (fail|failed|break|broke)\b|\bwhy did\b[^.?!]{0,80}\bfail\b/i,
  memory_forget: /\bforget\b|\bdimentica\b/i,
  memory_flag: /\b(doubtful|outdated|out of date|no longer (right|true|correct)|(may|might) be wrong|is wrong now|not sure (it|that) is right)\b/i,
  memory_rules_write: /\bmemory rules?\b/i,
  secret_use: /\b(password|passcode|passphrase|pin code|wi-?fi key)\b/i,
  screen: /\b(tablet|tv|monitor|wall screen|kiosk|display)\b|\bon (the|my) [a-z]+ screen\b/i,
  computer: /\b(sandbox|sandboxed|safely|somewhere safe|not on this machine|risky|untrusted|sketchy|disposable|throwaway|virtual (desktop|machine))\b/i,
  pack: /\b(package|pack|bundle|export)\b[^.?!]{0,60}\b(skills?|recipes?|specialists?)\b|\b(other|another|second) hub\b/i,
  mcp_draft: /\bmcp\b/i,
  mcp_status: /\bmcp\b/i,
  service_draft: /\b(set up|connect|add|integrate|hook up|use)\b[^.?!]{0,40}\bapi\b|\bapi key\b/i,
  spend_propose: /\b(spend|spending|euros?|dollars?|budget)\b|[€$]\s?\d/i,
  permission_grant: /\b(let|allow|permit|grant)\b[^.?!]{0,40}\b(coder|tester|researcher|scout|reporter|archivist|blender|specialist|mission)\b/i,
  shell_job: /\b(dev server|in the background|npm run|start the (app|server|site|web ?app)|serve it)\b/i,
};

// The home, in the words people use for it: what a Home Assistant server's tools are for.
const HOME = /\b(lights?|lamps?|bulbs?|heating|heater|thermostat|radiators?|air ?con(ditioning)?|a\/c|locks?|locked|unlock(ed)?|front door|garage|blinds?|shutters?|curtains?|plugs?|sockets?|scenes?|alarm|vacuum|humidity|sensors?|luci|lampada|riscaldamento|tapparelle)\b|\bturn (on|off)\b|\bswitch (on|off)\b/i;

const serverOf = n => (/^mcp__((?:[^_]|_(?!_))+)__(.+)$/.exec(String(n)) || []).slice(1);
const isHome = (id, tools) => tools.some(t => /^Hass[A-Z]/.test(t)) || /home.?assistant|\bhass\b/i.test(id);

/** What an MCP server is for, from its tools: the home for Home Assistant, else its first tools' names. */
function mcpPurpose(id, tools) {
  if (isHome(id, tools)) return `the home — lights, climate, locks, covers, media (${tools.slice(0, 3).join(', ')}…)`;
  return `${tools.slice(0, 4).join(', ')}${tools.length > 4 ? ', …' : ''}`;
}

const wordsOf = s => String(s || '').toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/i).filter(w => w.length > 2);

/** Whether a request calls for an MCP server: its name said, the home for a home server, or its tools matching. */
function mcpCue(text, id, schemas) {
  const tools = schemas.map(s => serverOf(s.function?.name || s.name)[1]).filter(Boolean);
  const said = wordsOf(text);
  if (wordsOf(id.replace(/[-_]/g, ' ')).some(w => w.length > 3 && said.includes(w.toLowerCase()))) return true;
  if (isHome(id, tools) && HOME.test(text)) return true;
  const score = matcher(text)({ name: tools.join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '),
    description: schemas.map(s => s.function?.description || '').join(' ').slice(0, 4000), body: '' });
  return score >= 8;
}

/** An API service a request names: its name or title, or a trigger of a skill that goes with it (`services: […]`). */
function serviceCue(text) {
  try {
    const services = require('../../api-services/store').list().filter(s => s.actions?.length);
    if (!services.length) return false;
    const said = wordsOf(text);
    if (services.some(s => [s.name, ...wordsOf(s.title)].some(w => w.length > 2 && said.includes(String(w).toLowerCase())))) return true;
    const names = new Set(services.map(s => s.name));
    return require('../skill-triggers').match(text).some(h => skillServices(h.name).some(n => names.has(n)));
  } catch { return false; }
}

function skillServices(name) {
  try {
    const s = require('../skills').list().find(x => x.name === name);
    if (!s) return [];
    const md = require('fs').readFileSync(require('path').join(s.dir, 'SKILL.md'), 'utf8');
    const m = /^services:\s*\[?([^\]\n]*)\]?/m.exec(md.split(/\n---/)[0] || '');
    return m ? m[1].split(',').map(x => x.trim()).filter(Boolean) : [];
  } catch { return []; }
}

const MAX = 6;   // a request rarely needs more; a long one must not load half the list

/**
 * What a request's words call for among `schemas` (the held tools not sent): built-in names and `mcp:<id>` for a
 * server, at most MAX, servers first (a server is the whole framework for its domain).
 */
function cued(text, schemas) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const servers = new Map(), out = [];
  for (const s of schemas) {
    const n = s.function?.name || s.name, [server] = serverOf(n);
    if (server) { if (!servers.has(server)) servers.set(server, []); servers.get(server).push(s); continue; }
    if (n === 'service' ? serviceCue(t) : CUES[n]?.test(t)) out.push(n);
  }
  const mcp = [...servers].filter(([id, list]) => !/^computer-/.test(id) && mcpCue(t, id, list)).map(([id]) => `mcp:${id}`);
  return [...mcp, ...out].slice(0, MAX);
}

module.exports = { PURPOSE, CUES, HOME, cued, mcpPurpose, mcpCue, serviceCue };
