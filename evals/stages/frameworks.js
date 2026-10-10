'use strict';

/**
 * The stage of the `reaches-frameworks` set (asked 2026-10-10: "does the orchestrator organically reach everything?"):
 * the frameworks a hive has, standing in the sandbox so each case can measure whether the agent reaches for the one
 * made for the job rather than improvising with a shell, a raw request or a promise. Everything here is a stub:
 *
 *   - the API service `hi3d` from its shipped template, served by a local stand-in that answers a job and a file;
 *   - MCP servers `home-assistant` and `blender`, running, with the real servers' tool names, answering "done";
 *   - a paired phone, a watch and a linked Telegram chat (records only — nothing is delivered anywhere);
 *   - a saved recipe, two memories, a secret for devices, sample files and a small web app in the workspace;
 *   - the Library experiment with a folder (searching asks the embedding model; an empty answer is fine).
 *
 * What would start real work elsewhere answers as a stand-in that it started — a specialist's mission, a team, a work
 * chat, an agents' computer, a hub command — so no turn runs behind the case and nothing on this machine is started or
 * restarted; the call is what the case measures (a question on a device is answered yes). A question the approval gate
 * asks is answered at once: yes, once, for a framework's call; for what would act on this machine for real — a command
 * line, a file written, a request out — what it would read after five minutes of nobody. Only ever run inside a
 * sandbox (modules/evals/run.js checks).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
  + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

const HA_TOOLS = [
  ['HassTurnOn', 'Turns on/opens/presses a device or entity. For locks, this performs a \'lock\' action.', { name: 'string', area: 'string', floor: 'string', domain: 'array', device_class: 'array' }],
  ['HassTurnOff', 'Turns off/closes a device or entity. For locks, this performs an \'unlock\' action.', { name: 'string', area: 'string', floor: 'string', domain: 'array', device_class: 'array' }],
  ['HassLightSet', 'Sets the brightness percentage or color of a light', { name: 'string', area: 'string', brightness: 'integer', color: 'string' }],
  ['HassClimateSetTemperature', 'Sets the target temperature of a climate device or entity', { name: 'string', area: 'string', temperature: 'number' }],
  ['HassMediaPause', 'Pauses a media player', { name: 'string', area: 'string' }],
  ['HassSetVolume', 'Sets the volume percentage of a media player', { name: 'string', area: 'string', volume_level: 'integer' }],
  ['GetLiveContext', 'Provides real-time information about the CURRENT state, value, or mode of devices, sensors, entities, or areas. Use this tool for: 1. Answering questions about current conditions (e.g., \'Is the light on?\'). 2. As the first step in conditional actions.', {}],
];
const BLENDER_TOOLS = [
  ['get_scene_info', 'Get detailed information about the current Blender scene', {}],
  ['get_object_info', 'Get detailed information about a specific object in the Blender scene.', { object_name: 'string' }],
  ['execute_blender_code', 'Execute arbitrary Python code in Blender. Make sure to do it step-by-step by breaking it into smaller chunks.', { code: 'string' }],
  ['get_viewport_screenshot', 'Capture a screenshot of the current Blender 3D viewport.', { max_size: 'integer' }],
];
const READ = new Set(['GetLiveContext', 'get_scene_info', 'get_object_info', 'get_viewport_screenshot']);
const toolsOf = list => list.map(([name, description, props]) => ({ name, description, ...(READ.has(name) ? { annotations: { readOnlyHint: true } } : {}), inputSchema: { type: 'object',
  properties: Object.fromEntries(Object.entries(props).map(([k, t]) => [k, t === 'array' ? { type: 'array', items: { type: 'string' } } : { type: t }])) } }));

/** The hi3d stand-in: a submitted task is done at once, its model a few bytes. */
function hi3dStub() {
  const server = http.createServer((req, res) => {
    const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url.includes('/submit-task')) { req.resume(); return json({ code: 200, data: { task_id: 'eval-task-1' }, msg: 'success' }); }
    if (req.url.includes('/query-task')) return json({ code: 200, data: { task_id: 'eval-task-1', state: 'success', url: `${base}/files/model.glb`, cover_url: `${base}/files/cover.png` }, msg: 'success' });
    if (req.url.includes('/balance')) return json({ code: 200, data: { totalBalance: 100 }, msg: 'success' });
    if (req.url.includes('/files/')) { res.writeHead(200, { 'content-type': req.url.endsWith('.png') ? 'image/png' : 'model/gltf-binary' }); return res.end(req.url.endsWith('.png') ? PNG : Buffer.from('glTF')); }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function setup() {
  const root = process.env.DOCA_SANDBOX;
  if (!root) throw new Error('the frameworks stage runs only in a sandbox');
  const ws = process.env.WORKSPACE_DIR || root;
  const made = { servers: [], mcp: [] };
  const write = (rel, data) => { const f = path.join(ws, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };

  // Sample files: a report, a chart, a photo of a teapot, notes for the Library, and a small web app.
  write('report.pdf', '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  write('chart.png', PNG);
  write('teapot.png', PNG);
  const lib = path.join(root, 'library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'roof-repair-call.txt'), 'Notes from the call with the builder about the roof repair: tiles on the north side, quote next week.');
  write('hello-app/package.json', JSON.stringify({ name: 'hello-app', private: true, scripts: { dev: 'node server.js' } }, null, 2));
  write('hello-app/server.js', "const port = process.env.PORT || 5179;\nrequire('http').createServer((q, s) => s.end('<h1>Hello from hello-app</h1>')).listen(port, () => console.log(`Local: http://localhost:${port}/`));\nsetTimeout(() => process.exit(0), 10 * 60 * 1000);   // an evaluation's app never outlives it\n");

  // The hi3d service, at its stand-in.
  const stub = await hi3dStub();
  made.servers.push(stub);
  const def = require('../../modules/api-services/templates').load('hi3d').definition;
  require('../../modules/api-services/store').save({ ...def, name: 'hi3d', server: `http://127.0.0.1:${stub.address().port}/open-api/v1`, auth: { type: 'none' } });

  // MCP servers on this machine, running, as the owner's Home Assistant and Blender would be.
  const reg = require('../../modules/mcp/registry');
  for (const [id, label, list] of [['home-assistant', 'Home Assistant', HA_TOOLS], ['blender', 'Blender', BLENDER_TOOLS]]) {
    const spec = path.join(root, `${id}-tools.json`);
    fs.writeFileSync(spec, JSON.stringify(toolsOf(list)));
    reg.upsert({ id, label, transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'mcp-stub.js'), spec] });
    await reg.start(id);
    made.mcp.push(id);
  }

  // A phone, a watch and a linked Telegram chat — records, so the devices tools have somewhere to point.
  const devices = require('../../modules/api-v1/devices'), { PRESETS } = require('../../modules/api-v1/scopes');
  devices.create({ name: 'Pixel phone', kind: 'phone', scopes: PRESETS.phone, caps: { formFactor: 'phone' } });
  devices.create({ name: 'Galaxy watch', kind: 'watch', scopes: PRESETS.watch, caps: { formFactor: 'watch' } });
  devices.create({ name: 'Telegram · Al', kind: 'channel', scopes: ['interact', 'harness:chat', 'harness:sessions'], caps: { formFactor: 'phone' } });

  // What the hive has learned: a recipe, memories, a secret for devices.
  require('../../modules/recipes/store').save({ title: 'Disk space report', id: 'disk-space-report',
    description: 'How full each disk of this machine is, as a short report.', steps: [{ tool: 'shell', args: { command: 'df -h' } }] });
  const memory = require('../../modules/harness/memory');
  memory.memWrite({ key: 'office-router', value: 'The office router is at 192.168.1.1.', category: 'network', source: 'user' });
  memory.memWrite({ key: '3d-printer', value: 'The 3D printer is at 10.0.0.42.', category: 'network', source: 'user' });
  try { await require('../../modules/sealed/vault').save({ name: 'wifi-home', value: 'eval-stand-in-not-a-password', note: 'the home Wi-Fi' }); } catch { /* no vault here */ }

  // The Library experiment, over the sandbox's own folder.
  const { loadPrefs, savePrefs } = require('../../modules/utils');
  const prefs = loadPrefs();
  prefs.developer = { ...(prefs.developer || {}), mode: true };
  prefs.experiments = { ...(prefs.experiments || {}), library: true };
  prefs.library = { ...(prefs.library || {}), model: prefs.library?.model || 'embeddinggemma', folders: [lib] };
  savePrefs(prefs);

  // Stand-ins for what would start work elsewhere (put back in teardown).
  let n = 0;
  const said = what => `${what} (an evaluation's stand-in: nothing was started).`;
  const STAND_IN = {
    agent_dispatch: a => said(`Dispatched mission m_eval_${++n} to ${a.agent || a.agentId || 'a specialist'}; read its answer later with agent_results`),
    team: a => (a.action === 'create' ? said(`Team t_eval_${++n} created with ${(a.tasks || []).length} tasks; the hub dispatches them in order`) : null),
    work_chats: a => (['create', 'send'].includes(a.action) ? said(`Work chat wc_eval_${++n} ${a.action === 'create' ? 'created and briefed' : 'sent the message'}`) : null),
    computer: a => (a.action && a.action !== 'list' ? said(`Computer c_eval_${++n}: ${a.action} done`) : null),
    hub_command: a => (a.action === 'run' ? said(`${a.id}: done`) : null),
    ask_device: () => 'The person answered: yes (an evaluation\'s stand-in).',
  };
  const restore = [];
  for (const def of require('../../modules/harness/tools').TOOLS || []) {
    const stand = STAND_IN[def.name];
    if (!stand) continue;
    const real = def.run;
    def.run = (args = {}, ctx) => stand(args) ?? real(args, ctx);
    restore.push(() => { def.run = real; });
  }

  // A person answers at once: yes, once, to a framework's call (each is a stand-in, or acts only on this sandbox); no
  // to what would act on this machine for real — a command line, a file written, a request out — as nobody answering.
  const approval = require('../../modules/harness/approval');
  const REAL = new Set(['shell', 'shell_job', 'write_file', 'replace_in_files', 'git', 'api_call', 'http_fetch', 'project']);
  const answering = setInterval(() => {
    for (const q of approval.pending()) {
      const yes = !REAL.has(q.tool) || (q.tool === 'shell_job' && JSON.stringify(q.keys || []).includes('npm'));
      process.stderr.write(`stage: ${yes ? 'allowed once' : 'nobody answered'} ${q.tool} ${JSON.stringify(q.keys || [])}\n`);
      approval.entry(q.id)?.resolve(yes ? 'once' : 'timeout');
    }
  }, 250);

  return {
    async teardown() {
      clearInterval(answering);
      for (const r of restore) r();
      for (const id of made.mcp) try { reg.stop(id); } catch { /* gone */ }
      for (const s of made.servers) s.close();
      try { for (const j of require('../../modules/harness/jobs').list()) if (j.state === 'running') require('../../modules/harness/jobs').stop(j.id); } catch { /* none */ }
    },
  };
}

module.exports = { setup };
