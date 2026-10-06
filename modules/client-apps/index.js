'use strict';

/**
 * DOCA's own Android apps, served by the hub that they talk to (Settings → DOCA apps). Each app's latest build is kept
 * under DATA_DIR/clients/<app>/ — the APK and what it is (versionCode, versionName, sha256) — whether it was uploaded or
 * built here (build.js). A device asks `GET /api/v1/clients/android/<app>` and updates itself when the versionCode is
 * higher than its own (DocaMobile's updater); a person downloads it from the panel.
 *
 * An Android update installs only over an app signed with the same key, so the hub keeps one signing key
 * (keys/android-signing.keystore, protected) and signs what it builds with it; the phone's app must have been signed
 * with it too — the portal PC's debug key, today.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APPS = {
  docamobile: { label: 'DocaMobile', package: 'tech.honlab.doca', task: ':app:assembleDebug', apk: 'app/build/outputs/apk/debug/app-debug.apk', java: null },
  docawear: { label: 'DocaWear', package: 'tech.honlab.doca', task: ':app:assembleDebug', apk: 'app/build/outputs/apk/debug/app-debug.apk', java: 21 },
};
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dataDir = () => require('../store').DATA_DIR;
const dir = app => path.join(dataDir(), 'clients', app);
const known = app => { if (!APPS[app]) throw bad(`No DOCA app "${app}" (${Object.keys(APPS).join(', ')}).`, 404); return APPS[app]; };

/** The latest build of an app, or null. */
function latest(app) {
  known(app);
  try { return JSON.parse(fs.readFileSync(path.join(dir(app), 'latest.json'), 'utf8')); } catch { return null; }
}
const apkFile = app => path.join(dir(app), `${app}.apk`);

/** aapt2 from the Android SDK, when there is one: what an APK says it is. */
function aapt2() {
  const sdk = process.env.ANDROID_HOME || path.join(require('os').homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk');
  try {
    const versions = fs.readdirSync(path.join(sdk, 'build-tools')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) { const f = path.join(sdk, 'build-tools', v, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'); if (fs.existsSync(f)) return f; }
  } catch { /* no SDK */ }
  return null;
}

/** package, versionCode and versionName from the APK itself (aapt2), else from what the uploader said. */
function identify(file, given = {}) {
  const tool = aapt2();
  if (tool) {
    const r = require('child_process').spawnSync(tool, ['dump', 'badging', file], { encoding: 'utf8', timeout: 60000 });
    const m = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/.exec(r.stdout || '');
    if (m) return { package: m[1], versionCode: Number(m[2]), versionName: m[3] };
  }
  const versionCode = Number(given.versionCode);
  if (!Number.isInteger(versionCode) || versionCode < 1) throw bad('Say its versionCode (no Android SDK here to read it from the APK).');
  return { package: String(given.package || ''), versionCode, versionName: String(given.versionName || versionCode) };
}

/** Keep an APK as the app's latest. Refuses another package, and an older versionCode unless `force`. */
function keep(app, buffer, { from = 'upload', given = {}, force = false } = {}) {
  const a = known(app);
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw bad('That is not an APK (not a zip).');
  fs.mkdirSync(dir(app), { recursive: true });
  const tmp = path.join(dir(app), `incoming-${Date.now()}.apk`);
  fs.writeFileSync(tmp, buffer);
  try {
    const id = identify(tmp, given);
    if (id.package && id.package !== a.package) throw bad(`That APK is ${id.package}, not ${a.label} (${a.package}).`);
    const prev = latest(app);
    if (prev && id.versionCode < prev.versionCode && !force) throw bad(`It is older (${id.versionCode}) than the one kept (${prev.versionCode}).`, 409);
    fs.renameSync(tmp, apkFile(app));
    const meta = { app, label: a.label, ...id, package: id.package || a.package, bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'), from, at: new Date().toISOString() };
    fs.writeFileSync(path.join(dir(app), 'latest.json'), JSON.stringify(meta, null, 2));
    return meta;
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** Where each app's source is, and whether the hub holds the signing key. */
function settings() {
  const prefs = require('../utils').loadPrefs().clientApps || {};
  const p = require('../paths');
  return { apps: Object.fromEntries(Object.entries(APPS).map(([id, a]) => [id, { label: a.label, repo: prefs[id]?.repo || '', latest: latest(id) }])),
    signing: fs.existsSync(p.ANDROID_SIGNING_STORE) ? { kept: true, ...JSON.parse(fs.readFileSync(p.ANDROID_SIGNING_FILE, 'utf8') || '{}'), storePassword: undefined, keyPassword: undefined } : { kept: false } };
}

function setRepo(app, repo) {
  known(app);
  const r = String(repo || '').trim();
  if (r && !fs.existsSync(path.join(r, 'settings.gradle.kts')) && !fs.existsSync(path.join(r, 'settings.gradle'))) throw bad(`${r} is not a Gradle project (no settings.gradle.kts).`);
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, clientApps: { ...(prefs.clientApps || {}), [app]: { ...(prefs.clientApps?.[app] || {}), repo: r } } });
  return settings();
}

/** The signing key: a keystore and how to open it (alias, passwords). Kept 0600 under keys/, never read back. */
function setSigning(buffer, { alias = 'androiddebugkey', storePassword = 'android', keyPassword = 'android' } = {}) {
  const p = require('../paths');
  if (buffer.length < 32) throw bad('That is not a keystore.');
  fs.mkdirSync(path.dirname(p.ANDROID_SIGNING_STORE), { recursive: true });
  fs.writeFileSync(p.ANDROID_SIGNING_STORE, buffer, { mode: 0o600 });
  fs.writeFileSync(p.ANDROID_SIGNING_FILE, JSON.stringify({ alias, storePassword, keyPassword, at: new Date().toISOString(),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16) }), { mode: 0o600 });
  for (const f of [p.ANDROID_SIGNING_STORE, p.ANDROID_SIGNING_FILE]) try { fs.chmodSync(f, 0o600); } catch { /* Windows */ }
  return settings();
}

/** The environment a build signs with (DocaMobile's build.gradle.kts reads DOCA_SIGNING_*), or {} without a key. */
function signingEnv() {
  const p = require('../paths');
  if (!fs.existsSync(p.ANDROID_SIGNING_STORE)) return {};
  const s = JSON.parse(fs.readFileSync(p.ANDROID_SIGNING_FILE, 'utf8'));
  return { DOCA_SIGNING_STORE: p.ANDROID_SIGNING_STORE, DOCA_SIGNING_ALIAS: s.alias, DOCA_SIGNING_STORE_PASSWORD: s.storePassword, DOCA_SIGNING_KEY_PASSWORD: s.keyPassword };
}

module.exports = { APPS, latest, apkFile, keep, identify, settings, setRepo, setSigning, signingEnv, known };
