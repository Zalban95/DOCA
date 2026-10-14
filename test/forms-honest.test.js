'use strict';

/**
 * Forms say what happened (the owner's UI rule; newcomer run 2026-10-14, on a core-only install): each button the run
 * found silent or falsely successful, pressed with a real mouse in a real browser on a hub with no licence, and what the
 * page then says. Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
// The core only, as a newcomer's install runs: the suite's preloaded licence for everything left out before the app is made.
require('../modules/license/keys').preloaded.certificate = null;
require('../modules/license').reload();
const B = require('./panel-browser');

// Loaded again when the first load threw (a script lost to a busy runner: "controlsInit is not defined"): every test
// here checks the page made no error, and one at load is not theirs.
before(async () => { await B.start({ setup: B.pastFirstRun }); if (B.errors.length) { B.errors.splice(0); await B.open(); } });
after(() => B.stop());

// Moved between as a person does, in the one page: a page loaded afresh per test left the last one's live stream
// holding a connection, and by the sixth the browser had none left for the next page's requests.
const go = (page, sub = null) => B.evaluate(sub ? `settingsSubNav(${JSON.stringify(sub)})` : `nav(${JSON.stringify(page)})`);
const text = sel => B.evaluate(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').trim()`);

test('the hub runs the core only', { skip: B.skip }, async () => {
  assert.equal(await B.evaluate("fetch('/api/licence').then(r => r.json()).then(j => j.source)"), 'none');
});

test('Backups: saving an empty password says nothing was saved', { skip: B.skip }, async () => {
  await go('settings', 'backups');
  assert.ok(await B.until("!!document.getElementById('backup-password') && document.getElementById('backup-password').getClientRects().length > 0"), 'the password field is drawn');
  assert.ok(await B.clickOn('#backup-password-row button[onclick="backupPasswordSave()"]'));
  assert.ok(await B.until("/Nothing saved/.test(document.getElementById('backup-status')?.textContent || '')"), await text('#backup-status'));
  assert.doesNotMatch(await text('#backup-status'), /Password saved/);
  assert.deepEqual(B.errors, []);
});

// Entering Settings asks which harnesses are installed (seconds), then shows its section — and used to go back to
// Settings to do it, taking the page a person had moved on to from under them: the likely end of the run's "+ Add server".
test('Settings does not pull a person back once they moved on', { skip: B.skip }, async () => {
  await B.evaluate(`(() => { const real = apiFetch; window._slowHarness = true;
    apiFetch = async (url, ...rest) => { if (window._slowHarness && url === '/api/harness') await new Promise(r => setTimeout(r, 1200)); return real(url, ...rest); }; })()`);
  await go('settings', 'general');
  await go('mcp');
  await B.sleep(2500);
  await B.evaluate('window._slowHarness = false');
  assert.equal(await B.evaluate('currentTab'), 'mcp');
});

// On the core only "+ Add server" opens the form at every width. What a press does is now also said and lit, so a
// second press, with the form already open below, is seen too.
test('MCP: "+ Add server" opens the form, says so, twice', { skip: B.skip }, async () => {
  await go('mcp');
  assert.ok(await B.until("document.querySelector('#mcp-list .placeholder:not(.pulse)') !== null"), 'the list is drawn');
  const state = () => B.evaluate("JSON.stringify({ tab: currentTab, shown: document.getElementById('mcp-form').getClientRects().length })");
  for (let i = 0; i < 2; i++) {
    await B.evaluate("document.getElementById('mcp-form-status').textContent = ''");
    assert.ok(await B.clickOn('#tab-mcp .page-head-acts .btn-primary'), `press ${i + 1}: the button is there to press ` + await state());
    assert.ok(await B.until("document.getElementById('mcp-form').getClientRects().length > 0"), `press ${i + 1}: the form opens ` + await state());
    assert.match(await text('#mcp-form-status'), /A new server/);
  }
  assert.deepEqual(B.errors, []);
});

test('Users: "+ Add person" with no email says what it needs', { skip: B.skip }, async () => {
  await go('settings', 'users');
  assert.ok(await B.until("!!document.getElementById('users-new-email')"), 'the add row is drawn');
  assert.ok(await B.clickOn('button[onclick="usersAdd()"]'));
  assert.ok(await B.until("/Type their email/.test(document.getElementById('users-new-status')?.textContent || '')"), await text('#users-new-status'));
  assert.equal(await B.evaluate('document.activeElement?.id'), 'users-new-email');
  assert.deepEqual(B.errors, []);
});

// The run saw nothing: "✓ Saved" was there, and gone three seconds later, before it looked.
test('Models: the Ollama card\'s Save says what it saved, and the line stays', { skip: B.skip }, async () => {
  await go('models');
  assert.ok(await B.until("!!document.getElementById('models-ollama-url')?.value"), 'the card is filled');
  // The folder as Ollama has it, so Save only saves (a different folder asks first and moves the models).
  await B.until('_ollamaHome !== null', 5000);
  await B.evaluate("document.getElementById('models-ollama-path').value = _ollamaHome?.current || ''");
  assert.ok(await B.clickOn('button[onclick="modelsSaveSettings()"]'));
  assert.ok(await B.until("/Saved — Ollama is asked at http/.test(document.getElementById('models-settings-status').textContent)"), await text('#models-settings-status'));
  await B.sleep(4000);
  assert.match(await text('#models-settings-status'), /Saved/, 'still there after four seconds');
  assert.deepEqual(B.errors, []);
});

test('Set-up: "Only show what it would do" answers, with nothing to do and with something', { skip: B.skip }, async () => {
  await go('settings', 'guided');   // it looks at the machine first (GPUs, runtimes): seconds, more on a busy runner
  assert.ok(await B.until("!!document.querySelector('button[onclick=\"guidedPreview(this)\"]') && !!document.querySelector('#guided-plan .card')", 45000), 'the form and its plan are drawn');
  await B.sleep(500);   // the plan drawn at load has settled
  // With something to set up (no model here yet: the agent's own is the first step).
  assert.ok(await B.clickOn('button[onclick="guidedPreview(this)"]'));
  assert.ok(await B.until("/what it would set up\\. Nothing has changed yet/.test(document.getElementById('guided-status').textContent)"), await text('#guided-status'));
  // With nothing: a hub where everything it needs is here, as the newcomer's was (its model answered). The plan is the hub's
  // answer for such a hub — every step "have" — given in the page, since this test hub has no model that answers.
  await B.evaluate(`(() => { const real = apiFetch; apiFetch = async (url, ...rest) => url === '/api/guided/plan'
    ? { steps: [{ type: 'have', role: 'chat', label: "The agent's model", model: 'm', provider: 'p' }], devices: [] } : real(url, ...rest); })()`);
  assert.ok(await B.clickOn('button[onclick="guidedPreview(this)"]'));
  assert.ok(await B.until("/Nothing to do: everything this needs is here/.test(document.getElementById('guided-status').textContent)"), await text('#guided-status'));
  assert.match(await text('#guided-plan'), /Nothing to set up: everything this needs is here/);
  assert.deepEqual(B.errors, []);
});

test('Packs: a library pack\'s "Bring in…" preview has a way out', { skip: B.skip }, async () => {
  const skill = require('fs').readdirSync(require('path').join(__dirname, '..', 'skills'))[0];
  const kept = await H.api(null, 'POST', '/api/packs/library', { name: 'a-test-pack', skills: [skill] });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  await go('settings', 'packs');
  assert.ok(await B.until(`!!document.querySelector('button[onclick*="packsPlan(null"]')`), 'the library lists it');
  assert.ok(await B.clickOn('button[onclick*="packsPlan(null"]'));
  assert.ok(await B.until("/Bring in the ticked ones/.test(document.getElementById('pack-plan').textContent)"), 'the preview opens');
  assert.ok(await B.clickOn('#pack-plan button[onclick="packsPlanClose()"]'), 'it has a Cancel');
  assert.ok(await B.until("document.getElementById('pack-plan').textContent.trim() === ''"), 'Cancel closes it');
  assert.equal(await B.evaluate('_packLib'), null, 'and lets the pack go');
  assert.deepEqual(B.errors, []);
});

test('Packs: a pack with no name is asked for one, offering what it holds', { skip: B.skip }, async () => {
  await go('settings', 'packs');
  assert.ok(await B.until("!!document.querySelector('#sp-packs input[data-pack]')"), 'the things a pack can hold are listed');
  const first = await B.evaluate("(() => { const i = document.querySelector('#sp-packs input[data-pack]'); i.checked = true; document.getElementById('pack-name').value = ''; return i.value; })()");
  assert.ok(await B.clickOn('button[onclick="packsExport(true)"]'));
  assert.ok(await B.until("document.getElementById('app-prompt-modal').classList.contains('open')"), 'the name is asked');
  assert.match(await text('#app-prompt-message'), /What is this pack called/);
  assert.equal(await B.evaluate("document.getElementById('app-prompt-input').value"), first, 'the first thing ticked is offered');
  await B.evaluate("document.getElementById('app-prompt-input').value = 'named-by-test'");
  assert.ok(await B.clickOn('#app-prompt-ok'));
  assert.ok(await B.until("document.getElementById('app-confirm-modal')?.classList.contains('open') || document.querySelector('.app-confirm-backdrop.open')"), 'it says what it kept');
  assert.ok(await B.until("/Kept \"named-by-test\"/.test(document.body.innerText)"), await B.evaluate("document.querySelector('.app-confirm-backdrop.open')?.innerText || ''"));
  await B.evaluate("document.querySelector('.app-confirm-backdrop.open button')?.click()");
  assert.deepEqual(B.errors, []);
});

test('API keys: a screen says what it shows, and how to open a page there, in two sentences', { skip: B.skip }, async () => {
  await go('apikeys');
  assert.ok(await B.until("!!document.querySelector('.dev-show')"), 'this browser is listed as a screen');
  const line = await B.evaluate("document.querySelector('.dev-show').parentElement.innerText");
  assert.match(line, /(On its screen now: .+\.|Not open now\.)/);
  assert.match(line, /Open a page there:/);
  assert.doesNotMatch(line, /show here/);
  assert.deepEqual(B.errors, []);
});

test('the panel\'s own dialogs say they are dialogs, and an empty answer is asked for', { skip: B.skip }, async () => {
  await B.evaluate("appPrompt('A question?', () => {})");
  assert.ok(await B.until("document.getElementById('app-prompt-modal').classList.contains('open')"));
  const d = await B.evaluate("(() => { const b = document.querySelector('#app-prompt-modal [role=dialog]'); return b && { modal: b.getAttribute('aria-modal'), named: document.getElementById(b.getAttribute('aria-labelledby'))?.textContent, shown: b.getClientRects().length > 0 }; })()");
  assert.deepEqual(d, { modal: 'true', named: 'A question?', shown: true });
  assert.ok(await B.clickOn('#app-prompt-ok'));
  assert.equal(await B.evaluate("document.getElementById('app-prompt-input').validationMessage"), 'Type an answer — or Cancel.', 'OK with nothing typed says so');
  assert.ok(await B.evaluate("document.getElementById('app-prompt-modal').classList.contains('open')"), 'and stays open');
  await B.clickOn('#app-prompt-cancel');
  assert.equal(await B.evaluate("document.querySelector('#app-confirm-modal [role=alertdialog]')?.getAttribute('aria-modal')"), 'true');
  // The approval popup: a question that must be answered.
  await B.evaluate("approvalPopup({ id: 'appr-test', tool: 'shell', args: { command: 'true' }, keys: [] }, () => {})");
  const a = await B.evaluate("(() => { const m = document.querySelector('#approval-overlay [role=alertdialog]'); return m && { modal: m.getAttribute('aria-modal'), named: !!document.getElementById(m.getAttribute('aria-labelledby'))?.textContent }; })()");
  assert.deepEqual(a, { modal: 'true', named: true });
  await B.evaluate("document.getElementById('approval-overlay')?.remove()");
  assert.deepEqual(B.errors, []);
});
