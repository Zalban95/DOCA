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

/** A real picture, w×h, drawn by `px(x, y)` → [r, g, b]: a 1×1 file read as "not a real chart" and sent the agent checking. */
function png(w, h, px) {
  const zlib = require('zlib');
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const CHART = png(640, 360, (x, y) => { const bars = [120, 95, 140, 80], i = Math.floor((x - 60) / 140); return i >= 0 && i < 4 && (x - 60) % 140 < 90 && y > 330 - bars[i] * 2 ? [70, 130, 220] : [250, 250, 250]; });
const TEAPOT = png(512, 512, (x, y) => { const d = Math.hypot(x - 256, y - 290); return d < 150 || (y > 200 && y < 240 && x > 380 && x < 470) ? [190, 120, 80] : [255, 255, 255]; });
const PDF = ['%PDF-1.4', '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj', '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
  '4 0 obj << /Length 120 >> stream', 'BT /F1 24 Tf 72 760 Td (Quarterly report) Tj /F1 12 Tf 0 -40 Td (Revenue rose 12% on the quarter; costs held flat.) Tj ET', 'endstream endobj',
  '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF', ''].join('\n');

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
  write('report.pdf', PDF);
  write('chart.png', CHART);
  write('teapot.png', TEAPOT);
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
  const STATE = {
    'home-assistant': { state: { 'Living room': { 'light.living_room': 'on, 80%', 'media_player.tv': 'off' }, Hall: { 'climate.hall': 'heat, 19 °C, target 20 °C' },
      Entrance: { 'lock.front_door': 'locked', 'binary_sensor.front_door': 'closed' } } },
    blender: { state: { scene: 'Scene', objects: [{ name: 'Camera', type: 'CAMERA' }, { name: 'Light', type: 'LIGHT' }] }, get_viewport_screenshot: 'Screenshot saved.' },
  };
  for (const [id, label, list] of [['home-assistant', 'Home Assistant', HA_TOOLS], ['blender', 'Blender', BLENDER_TOOLS]]) {
    const spec = path.join(root, `${id}-tools.json`);
    fs.writeFileSync(spec, JSON.stringify(toolsOf(list)));
    reg.upsert({ id, label, transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'mcp-stub.js'), spec], env: { STUB_STATE: JSON.stringify(STATE[id]) } });
    await reg.start(id);
    made.mcp.push(id);
  }

  // The person the cases act for — the hive's owner, as in the panel — and their phone, watch and linked Telegram chat
  // (records, so the devices tools have somewhere to point). A reminder, a meeting or a budget needs somebody.
  const auth = require('../../modules/auth/store');
  const org = auth.defaultOrg() || auth.createOrg('Evaluation');
  const user = auth.userByEmail('owner@eval.local') || auth.createUser({ email: 'owner@eval.local', name: 'Owner', passwordHash: 'x' });
  if (!auth.membership(org.id, user.id)) auth.addMembership({ orgId: org.id, userId: user.id, role: 'owner', status: 'active' });
  const person = require('../../modules/harness/turn/client').personById({ id: user.id, orgId: org.id });
  const devices = require('../../modules/api-v1/devices'), { PRESETS } = require('../../modules/api-v1/scopes');
  for (const d of [{ name: 'Pixel phone', kind: 'phone', scopes: PRESETS.phone, caps: { formFactor: 'phone' } },
    { name: 'Galaxy watch', kind: 'watch', scopes: PRESETS.watch, caps: { formFactor: 'watch' } },
    { name: 'Telegram · Owner', kind: 'channel', scopes: ['interact', 'harness:chat', 'harness:sessions'], caps: { formFactor: 'phone' } }])
    devices.update(devices.create(d).device.id, { userId: user.id, orgId: org.id });

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
  // Worded as the real tool's success: a stand-in that says "nothing was started" sent the agent off to check with a
  // shell, which measured the stand-in rather than the choice (first baseline, 2026-10-10).
  let n = 0;
  const STAND_IN = {
    agent_dispatch: a => `Dispatched mission m_eval_${++n} to ${a.agent || 'a specialist'}. It runs in the background; read its answer later with agent_results.`,
    team: a => (a.action === 'create' ? `Team t_eval_${++n} created with ${(a.tasks || []).length} tasks; the hub dispatches them in order and checks each contract.` : null),
    work_chats: a => (a.action === 'create' ? `Created work chat wc_eval_${++n} and briefed it; it works on its own and reports back.` : a.action === 'send' ? 'Sent.' : null),
    computer: a => (a.action && a.action !== 'list' ? `Computer c_eval_${++n}: ${a.action} done.` : null),
    hub_command: a => (a.action === 'run' ? `${a.id}: done.` : null),
    ask_device: () => 'The person answered: yes.',
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

  // What each call asked and what came back, on stderr (the run's .err file): why a case went the way it did.
  const agent = require('../../modules/harness/agent');
  const trail = e => {
    if (e.type === 'tool_call') process.stderr.write(`stage: call ${e.name} ${JSON.stringify(e.args || {}).slice(0, 300)}\n`);
    else if (e.type === 'tool_result') process.stderr.write(`stage: result ${e.name} ${String(e.result || '').replace(/\s+/g, ' ').slice(0, 300)}\n`);
    else if (e.type === 'session') process.stderr.write('stage: ---- turn\n');
  };
  agent.events.on('event', trail);

  return {
    person,
    async teardown() {
      agent.events.off('event', trail);
      clearInterval(answering);
      for (const r of restore) r();
      for (const id of made.mcp) try { reg.stop(id); } catch { /* gone */ }
      for (const s of made.servers) s.close();
      try { for (const j of require('../../modules/harness/jobs').list()) if (j.state === 'running') require('../../modules/harness/jobs').stop(j.id); } catch { /* none */ }
    },
  };
}

module.exports = { setup };
