'use strict';

// DOCA's Android apps on the hub (modules/client-apps): the newest build kept per app, uploaded or built here with the
// hub's signing key, and offered to devices at /api/v1/clients/android/<app> so DocaMobile can update itself.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const posix = process.platform !== 'win32';
let phone;
// Not a real APK — aapt2 cannot read it, so the hub goes by the versionCode it was given, as on a hub without the SDK.
const fakeApk = tag => require('../modules/packs/zip').write([{ name: 'AndroidManifest.xml', data: `fake ${tag}` }]);
const upload = (body, q = '') => fetch(`${H.base}/api/clients/apps/docamobile${q}`, { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie } })
  .then(async r => ({ status: r.status, body: await r.json() }));

before(async () => { await H.start(); phone = H.mkDevice('Phone', 'phone', H.PHONE_CAPS); });
after(() => H.stop());

test('an uploaded APK is the app\'s latest; a device reads what it is and downloads it', async () => {
  assert.equal((await fetch(`${H.base}/api/v1/clients/android/docamobile`, { headers: { Authorization: `Bearer ${phone.token}` } })).status, 404, 'nothing kept yet');
  assert.equal((await upload(Buffer.from('not a zip'), '?versionCode=5')).status, 400);
  const r = await upload(fakeApk('a'), '?versionCode=101&versionName=1.0.1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.versionCode, 101);
  const v = await (await fetch(`${H.base}/api/v1/clients/android/docamobile`, { headers: { Authorization: `Bearer ${phone.token}` } })).json();
  assert.deepEqual([v.versionCode, v.versionName, v.url], [101, '1.0.1', '/api/v1/clients/android/docamobile/apk']);
  const apk = Buffer.from(await (await fetch(`${H.base}${v.url}`, { headers: { Authorization: `Bearer ${phone.token}` } })).arrayBuffer());
  assert.equal(require('node:crypto').createHash('sha256').update(apk).digest('hex'), v.sha256, 'what it downloads is what it was told');
  assert.equal((await upload(fakeApk('b'), '?versionCode=100')).status, 409, 'an older one is refused…');
  assert.equal((await upload(fakeApk('b'), '?versionCode=100&force=1')).status, 200, '…unless forced');
  assert.equal((await fetch(`${H.base}/api/v1/clients/android/nope`, { headers: { Authorization: `Bearer ${phone.token}` } })).status, 404);
  const member = await H.signIn('member');
  assert.equal((await fetch(`${H.base}/api/clients/apps/docamobile`, { method: 'POST', body: fakeApk('c'), headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: member.cookie } })).status, 403);
});

test('the signing key is kept, never read back, and signs what the hub builds', { skip: !posix && 'a POSIX fake Gradle' }, async () => {
  const s = await fetch(`${H.base}/api/clients/apps/signing?alias=androiddebugkey`, { method: 'POST', body: Buffer.alloc(64, 7), headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie } }).then(r => r.json());
  assert.equal(s.signing.kept, true);
  assert.ok(!JSON.stringify(s).includes('"android"'), 'passwords never read back');
  const p = require('../modules/paths');
  assert.ok(p.PROTECTED_FILES.includes(p.ANDROID_SIGNING_STORE));
  assert.equal(fs.statSync(p.ANDROID_SIGNING_STORE).mode & 0o777, 0o600);

  // A repository whose "Gradle" checks it was handed the key and writes an APK where the real one does.
  const repo = path.join(H.tmp, 'FakeMobile');
  fs.mkdirSync(path.join(repo, 'app/build/outputs/apk/debug'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'settings.gradle.kts'), '');
  fs.writeFileSync(path.join(repo, 'app/build.gradle.kts'), 'android { defaultConfig { versionCode = 102\n versionName = "1.0.2" } }');
  fs.writeFileSync(path.join(repo, 'apk.zip'), fakeApk('built'));
  fs.writeFileSync(path.join(repo, 'gradlew'), '#!/bin/sh\n[ -f "$DOCA_SIGNING_STORE" ] && echo "signing with $DOCA_SIGNING_ALIAS" || { echo "no key"; exit 3; }\ncp apk.zip app/build/outputs/apk/debug/app-debug.apk\n');
  assert.equal((await H.api(null, 'POST', '/api/clients/apps/docamobile/repo', { repo: '/nonexistent' })).status, 400);
  assert.equal((await H.api(null, 'POST', '/api/clients/apps/docamobile/repo', { repo })).status, 200);
  const r = await fetch(`${H.base}/api/clients/apps/docamobile/build`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie }, body: '{}' });
  const text = await r.text();
  assert.match(text, /signing with androiddebugkey/);
  assert.match(text, /"ok":true/, text.slice(-400));
  assert.deepEqual([require('../modules/client-apps').latest('docamobile').from, require('../modules/client-apps').latest('docamobile').versionCode], ['build', 102]);
});

test('a ten-minute download link needs no sign-in — what a phone\'s browser opens to save the APK', async () => {
  const link = await H.api(null, 'POST', '/api/clients/apps/docamobile/link', {});
  assert.equal(link.status, 200, JSON.stringify(link.body));
  assert.match(link.body.path, /^\/api\/clients\/apps\/docamobile\/apk\/[A-Za-z0-9_-]{32}$/);
  const fqdn = require('../modules/https-cert').getTailscaleFqdn();
  if (fqdn) assert.equal(new URL(link.body.url).hostname, fqdn, 'a link made from this machine is for a phone: never 127.0.0.1');
  const r = await fetch(`${H.base}${link.body.path}`);   // no cookie, no token
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(r.headers.get('content-disposition'), /docamobile-.*\.apk/);
  assert.equal((await fetch(`${H.base}/api/clients/apps/docamobile/apk/${'x'.repeat(32)}`)).status, 404, 'a made-up link');
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'POST', '/api/clients/apps/docamobile/link', {}, { Cookie: member.cookie })).status, 403, 'making one is a host\'s');
});

test('a device reads every address the hub answers at, without the QR codes', async () => {
  const r = await (await fetch(`${H.base}/api/v1/hub/links`, { headers: { Authorization: `Bearer ${phone.token}` } })).json();
  assert.ok(Array.isArray(r.links) && r.mode, 'a list and how the hub listens');
  for (const l of r.links) { assert.match(l.url, /^https?:\/\//); assert.equal(l.qr, undefined, 'no QR for a device'); }
  assert.equal((await fetch(`${H.base}/api/v1/hub/links`)).status, 401, 'a token is needed');
});
