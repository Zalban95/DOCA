'use strict';

/**
 * Field → Connectors → API services, the form as a person uses it (the owner on hi3d, 2026-10-10: "many clicks on
 * different buttons clear the fields", "I linked a skill — no Save button", and ✨ asked the agent about "this
 * service"). In a real browser: what was typed stays through every button and every redraw of the page; a saved
 * service shows Save the moment anything in it changes, and a linked skill is still linked after a reload; the ✨
 * request names the service, its address, its docs and its actions. Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');

const SHOTS = process.env.DOCA_SHOTS;
const OPENAPI = JSON.stringify({ openapi: '3.0.0', servers: [{ url: 'https://api.meshes.example' }], paths: {
  '/tasks': { post: { operationId: 'submitTask', summary: 'Start a model' } },
  '/balance': { get: { operationId: 'getBalance', summary: 'What is left' } } } });

before(() => B.start({ setup: async h => {
  B.pastFirstRun();
  const save = await h.api(null, 'POST', '/api/connectors/services/all', { name: 'meshes', server: 'https://api.meshes.example', key: 'k-123', note: '3D models',
    docs: 'https://docs.meshes.example', openapi: OPENAPI, auth: { type: 'bearer' } });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const sk = await h.api(null, 'POST', '/api/harness/skills', { name: 'meshes-skill', description: 'When to make a 3D model', body: '# Meshes\nUse submitTask.' });
  assert.equal(sk.status, 200, JSON.stringify(sk.body));
} }));
after(() => B.stop());

const toConnectors = async () => {
  await B.evaluate("nav('connectors')");
  assert.ok(await B.until("!!document.getElementById('sk-name') && !!document.getElementById('sk-foot')"), 'the API service form is drawn');
  await B.sleep(400);
};
const typed = { 'sk-name': 'widgets', 'sk-origin': 'https://api.widgets.example', 'sk-note': 'makes widgets', 'sk-key': 'secret-typed',
  'sk-headers': 'X-Client: doca', 'sk-rate': '30', 'sk-docs': 'https://docs.widgets.example', 'sk-skill-q': 'wid' };
const type = values => B.evaluate(`(() => { for (const [id, v] of Object.entries(${JSON.stringify(values)})) {
  const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
const read = ids => B.evaluate(`Object.fromEntries(${JSON.stringify(ids)}.map(id => [id, document.getElementById(id)?.value ?? null]))`);
const click = js => B.evaluate(`(async () => { ${js} })()`).then(() => B.sleep(500));

test('what was typed stays through every button and a redraw of the page', { skip: B.skip }, async () => {
  await toConnectors();
  await type(typed);
  const keep = Object.keys(typed);
  const steps = {
    'open the Advanced fold': "document.querySelector('[data-fold-id=\"service-keys\"] > summary').click()",
    'close the Advanced fold': "document.querySelector('[data-fold-id=\"service-keys\"] > summary').click()",
    'Read the actions (empty)': "await serviceReadActions()",
    'search skills here': "serviceSkillLocal()",
    'search the public collections': "await serviceSkillSearch().catch(() => {})",
    '✨ Write one from the docs': "serviceAskSkill()",
    'Find in the box above, then switch': "document.getElementById('sa-q-services').value = 'http://127.0.0.1:9/v1'; await serviceAddFind('services'); serviceAddSwitch('services'); await new Promise(r => setTimeout(r, 300)); serviceAddSwitch('services')",
    'a ready-made service, keeping mine': "await serviceUseTemplate('hi3d')",
    'Try on a saved row': "await serviceTry('meshes')",
    'the page drawn again': "await connectorsLoad()",
    'another page and back': "nav('apikeys'); await new Promise(r => setTimeout(r, 400)); nav('connectors'); await new Promise(r => setTimeout(r, 900))",
  };
  for (const [step, js] of Object.entries(steps)) {
    await click(js);
    // A fill that would replace what was typed asks; Cancel keeps the person's.
    await click("if (document.getElementById('app-confirm-modal')?.classList.contains('open')) document.getElementById('app-confirm-cancel').click()");
    await B.until("!!document.getElementById('sk-name')");
    const now = await read(keep);
    for (const id of keep) assert.equal(now[id], typed[id], `${id} after "${step}"`);
  }
  // Switching how it signs in carries the key into the two boxes and back.
  await type({ 'sk-place': 'bearer', 'sk-key': 'id1:sec1' });
  await click("const s = document.getElementById('sk-place'); s.value = 'exchange'; s.dispatchEvent(new Event('change', { bubbles: true }))");
  assert.deepEqual(await read(['sk-id', 'sk-secret', 'sk-name']), { 'sk-id': 'id1', 'sk-secret': 'sec1', 'sk-name': 'widgets' });
  await click("const s = document.getElementById('sk-place'); s.value = 'bearer'; s.dispatchEvent(new Event('change', { bubbles: true }))");
  assert.equal((await read(['sk-key']))['sk-key'], 'id1:sec1');
  if (SHOTS) await B.shot(`${SHOTS}/new-service-typed.png`);
  // Start over is the person asking: it clears.
  await click("document.querySelector('#sk-foot [data-act=\"reset\"]').click(); await new Promise(r => setTimeout(r, 300)); document.getElementById('app-confirm-ok')?.click()");
  assert.equal((await read(['sk-name']))['sk-name'], '');
});

test('a saved service: a linked skill shows Save, is saved, and is still linked after a reload', { skip: B.skip }, async () => {
  await toConnectors();
  await click("await serviceEdit('meshes')");
  assert.match(await B.evaluate("document.getElementById('sk-head').textContent"), /meshes/);
  assert.equal(await B.evaluate("!!document.querySelector('#sk-foot [data-act=\"save\"]')"), false, 'no Save while nothing changed');
  await click("serviceSkillLink('meshes-skill')");
  assert.equal(await B.evaluate("!!document.querySelector('#sk-foot [data-act=\"save\"]')"), true, 'Save shows once the skill changed');
  assert.match(await B.evaluate("document.getElementById('sk-foot').textContent"), /skill/i);
  if (SHOTS) await B.shot(`${SHOTS}/skill-linked-unsaved.png`);
  await click("document.querySelector('#sk-foot [data-act=\"save\"]').click()");
  assert.ok(await B.until("/Saved/.test(document.getElementById('sk-foot').textContent)"), await B.evaluate("document.getElementById('sk-foot').textContent"));
  assert.equal((await read(['sk-skill', 'sk-name']))['sk-skill'], 'meshes-skill', 'the form keeps showing the service');
  if (SHOTS) await B.shot(`${SHOTS}/skill-saved.png`);
  const stored = await H.api(null, 'GET', '/api/connectors/services/meshes/form');
  assert.equal(stored.body.definition.skill, 'meshes-skill');
  assert.equal(stored.body.definition.hasKey, true, 'the key was kept');
  await B.open();
  await toConnectors();
  assert.match(await B.evaluate("document.getElementById('svc-rows').textContent"), /skill meshes-skill/);
  await click("await serviceEdit('meshes')");
  assert.equal((await read(['sk-skill']))['sk-skill'], 'meshes-skill');
});

test('✨ Write one from the docs names the service, its docs and its actions', { skip: B.skip }, async () => {
  await toConnectors();
  await click("await serviceEdit('meshes')");
  await click("document.getElementById('chat-input').value = ''; serviceAskSkill()");
  const said = await B.evaluate("document.getElementById('chat-input').value");
  for (const want of ['"meshes"', 'https://api.meshes.example', 'https://docs.meshes.example', 'submitTask', 'getBalance', 'meshes-skill'])
    assert.ok(said.includes(want), `${want} in: ${said}`);
  assert.doesNotMatch(said, /this service|service_draft|paste the key/, said);
  if (SHOTS) await B.shot(`${SHOTS}/ask-skill-saved.png`);
  // A service not saved yet is a draft for the agent to prepare.
  await click("serviceFormNew(true)");
  await type({ 'sk-name': 'gizmo', 'sk-docs': 'https://docs.gizmo.example' });
  await click("serviceAskSkill()");
  const draft = await B.evaluate("document.getElementById('chat-input').value");
  assert.match(draft, /"gizmo"/); assert.match(draft, /docs\.gizmo\.example/); assert.match(draft, /service_draft/);
  assert.deepEqual(B.errors, []);
});

test('the form on a phone: nothing wider than the screen', { skip: B.skip }, async () => {
  await B.viewport(390, 844);
  await toConnectors();
  await click("if (typeof chatOpen !== 'undefined' && chatOpen) toggleChat(); serviceFormNew(true)");
  await click("await serviceEdit('meshes'); document.querySelector('[data-fold-id=\"service-keys\"]').open = true; document.getElementById('sk-name').scrollIntoView({ block: 'start' })");
  const wide = await B.evaluate(`(() => { const card = document.getElementById('service-keys-card'), w = document.documentElement.clientWidth;
    return [...card.querySelectorAll('input, select, textarea, button')].filter(el => el.offsetParent && el.getBoundingClientRect().right > w + 1).map(el => el.id || el.textContent.trim().slice(0, 20)); })()`);
  assert.deepEqual(wide, []);
  assert.match(await B.evaluate("document.getElementById('sk-head').textContent"), /meshes/);
  if (SHOTS) {
    await B.shot(`${SHOTS}/phone-form.png`);
    await B.evaluate("document.getElementById('sk-foot').scrollIntoView({ block: 'center' })");
    await B.shot(`${SHOTS}/phone-foot.png`);
  }
  await B.viewport(1300, 900, false);
});
