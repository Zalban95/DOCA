'use strict';

// DocaWear's watch face as the hub's third Android app (modules/client-apps, `docawear-face`): built from DocaWear's
// repository, kept only with the Watch Face Push validation token its build writes, and served with it to the watch.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const posix = process.platform !== 'win32';
const TOKEN = 'oM0GkiG18VaKSmoaPzpQMfBgwKkQgZBwnx59uFSfhJQ=:MS4wLjA=';
let watch;
const fakeApk = tag => require('../modules/packs/zip').write([{ name: 'AndroidManifest.xml', data: `fake ${tag}` }]);
const upload = (body, q = '', headers = {}) => fetch(`${H.base}/api/clients/apps/docawear-face${q}`, { method: 'POST', body,
  headers: { 'Content-Type': 'application/octet-stream', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie, ...headers } })
  .then(async r => ({ status: r.status, body: await r.json() }));
const asWatch = p => fetch(`${H.base}/api/v1${p}`, { headers: { Authorization: `Bearer ${watch.token}` } });

before(async () => {
  // No Android SDK for these: the hub goes by the versionCode it is given, as on a hub without one.
  process.env.ANDROID_HOME = path.join(H.tmp, 'no-sdk');
  await H.start();
  watch = H.mkDevice('Watch', 'watch', H.WATCH_CAPS);
});
after(() => H.stop());

test('the face is listed beside the apps, built from DocaWear\'s repository unless it has one of its own', async () => {
  const s = (await H.api(null, 'GET', '/api/clients/apps')).body;
  assert.equal(s.apps['docawear-face'].label, 'DocaWear face');
  assert.equal(s.apps['docawear-face'].needsToken, true);
  assert.equal(s.apps['docawear-face'].repoOf, 'docawear');
  assert.equal(s.apps.docawear.needsToken, undefined, 'the apps need no token');
});

test('an uploaded face is kept only with its validation token, and the watch is handed both', async () => {
  assert.equal((await asWatch('/clients/android/docawear-face')).status, 404, 'nothing kept yet');
  const none = await upload(fakeApk('a'), '?versionCode=4&versionName=1.3.0');
  assert.equal(none.status, 400);
  assert.match(none.body.error, /validation token/);
  assert.equal((await upload(fakeApk('a'), '?versionCode=4', { 'X-Validation-Token': 'not a token' })).status, 400, 'a malformed one');
  const r = await upload(fakeApk('a'), '?versionCode=4&versionName=1.3.0', { 'X-Validation-Token': TOKEN });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await (await asWatch('/clients/android/docawear-face')).json();
  assert.deepEqual([v.app, v.versionCode, v.versionName, v.validationToken, v.url], ['docawear-face', 4, '1.3.0', TOKEN, '/api/v1/clients/android/docawear-face/apk']);
  const apk = Buffer.from(await (await fetch(`${H.base}${v.url}`, { headers: { Authorization: `Bearer ${watch.token}` } })).arrayBuffer());
  assert.equal(require('node:crypto').createHash('sha256').update(apk).digest('hex'), v.sha256);
  assert.equal((await upload(fakeApk('b'), '?versionCode=40')).status, 400, 'a newer face without its token is not kept either');
  assert.equal((await fetch(`${H.base}/api/clients/apps/docawear?versionCode=40`, { method: 'POST', body: fakeApk('w'),
    headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie } })).status, 200, 'the apps are kept as before');
  assert.equal((await asWatch('/clients/android/docawear')).status, 200);
  assert.equal((await (await asWatch('/clients/android/docawear')).json()).validationToken, undefined, 'only the face carries one');
});

test('no ten-minute browser link for the face: it goes on the wrist from the phone', async () => {
  const l = await H.api(null, 'POST', '/api/clients/apps/docawear-face/link', {});
  assert.equal(l.status, 400);
  assert.match(l.body.error, /phone/);
});

test('built here from DocaWear\'s repository, the face takes the token its build wrote', { skip: !posix && 'a POSIX fake Gradle' }, async () => {
  const repo = path.join(H.tmp, 'FakeWear');
  fs.mkdirSync(path.join(repo, 'watchface/build/outputs/apk/debug'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'settings.gradle.kts'), '');
  fs.writeFileSync(path.join(repo, 'watchface/build.gradle.kts'), 'android { defaultConfig { versionCode = 5\n versionName = "1.3.1" } }');
  fs.writeFileSync(path.join(repo, 'apk.zip'), fakeApk('built'));
  // Fails unless asked for the watch face's module; writes the APK and the token where DocaWear's build does.
  fs.writeFileSync(path.join(repo, 'gradlew'), '#!/bin/sh\necho "$@" | grep -q ":watchface:assembleDebug" || { echo "wrong task: $@"; exit 3; }\n'
    + 'cp apk.zip watchface/build/outputs/apk/debug/watchface-debug.apk\nmkdir -p watchface/build/outputs/push-token/debug\n'
    + `echo "${TOKEN.replace('MS4w', 'MS4x')}" > watchface/build/outputs/push-token/debug/validation-token.txt\n`);
  // The face has no folder of its own: DocaWear's is used. A JDK 21 toolchain is what DocaWear's Gradle needs.
  assert.equal((await H.api(null, 'POST', '/api/clients/apps/docawear/repo', { repo })).status, 200);
  const jdk = path.join(require('node:os').homedir(), '.gradle', 'jdks', 'temurin-21');
  if (!fs.existsSync(jdk)) return;   // the build refuses without it, by design (build.js)
  const r = await fetch(`${H.base}/api/clients/apps/docawear-face/build`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie }, body: '{}' });
  const text = await r.text();
  assert.match(text, /"ok":true/, text.slice(-600));
  const kept = require('../modules/client-apps').latest('docawear-face');
  assert.deepEqual([kept.from, kept.versionCode, kept.validationToken], ['build', 5, TOKEN.replace('MS4w', 'MS4x')]);
  // A repository whose :watchface predates the validator: an APK and no token.
  fs.writeFileSync(path.join(repo, 'gradlew'), '#!/bin/sh\ncp apk.zip watchface/build/outputs/apk/debug/watchface-debug.apk\n');
  fs.rmSync(path.join(repo, 'watchface/build/outputs/push-token'), { recursive: true });
  const again = await (await fetch(`${H.base}/api/clients/apps/docawear-face/build`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie }, body: '{}' })).text();
  assert.match(again, /no validation token/, 'a build that made no token keeps nothing');
});
