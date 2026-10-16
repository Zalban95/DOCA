'use strict';

// An important change in a call (public/js/important.js, face/face.js): the face's points turn the theme's red for a
// moment — their colour only — and go back, and the call's status line says the change; with no call on, the face is
// left alone. The scripts run in a sandbox with stand-ins for the canvas and the page.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function load() {
  const el = () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }), style: {}, width: 0, height: 0,
    getBoundingClientRect: () => ({ width: 100, height: 100 }), clientWidth: 100, clientHeight: 100, dataset: {} });
  const status = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Math, Date, performance,
    document: { documentElement: { dataset: {} }, createElement: el, getElementById: () => null, addEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: k => (k === '--red' ? ' #dc322f ' : '') }),
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, devicePixelRatio: 1,
    _callSetStatus: (t, s) => status.push([t, s]),
    window: { devicePixelRatio: 1, addEventListener() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${['face/face.js', 'face/poly.js', 'important.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n')}
    ;var _callActive = false, _callNoticeUntil = 0;
    globalThis.__ = { get: n => eval(n), set: (n, v) => eval(n + ' = v') };`, sandbox);
  return { s: sandbox.__, sandbox, status };
}

test('in a call, an important change turns every face red for a moment and says it; then back', async () => {
  const { s, status } = load();
  const face = s.get('faceMount')(s.get('document').createElement('canvas'), {});
  const alerts = [];
  const orig = face.alert;
  face.alert = (c, ms) => { alerts.push(c); orig(c, 40); };   // a short moment, for the test
  s.set('_callActive', true);
  assert.equal(s.get('importantCallAlert')('⚠ Changed: Approval mode: auto → manual'), true);
  assert.deepEqual(alerts, ['#dc322f'], 'the theme\'s red');
  assert.equal(face.alerting, true, 'the face is red now');
  assert.equal(s.get('importantAlerting')(), true);
  assert.deepEqual(status.at(-1), ['⚠ Changed: Approval mode: auto → manual', 'listening'], 'the call\'s status line says it');
  assert.equal(face.state, 'idle', 'the face\'s state — its shapes and motion — is unchanged');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(face.alerting, false, 'and back');
  face.stop();
  assert.equal(s.get('faceAlertAll')('#ff0000', 10), 0, 'a stopped face is no longer reached');
});

test('with no call open, the face is left alone', () => {
  const { s, status } = load();
  const face = s.get('faceMount')(s.get('document').createElement('canvas'), {});
  assert.equal(s.get('importantCallAlert')('⚠ Changed: x'), false);
  assert.equal(face.alerting, false);
  assert.equal(status.length, 0);
  face.stop();
});
