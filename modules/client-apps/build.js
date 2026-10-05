'use strict';

/**
 * Build one of DOCA's apps here, from its repository, and keep the APK as its latest (index.js). Gradle by argv — the
 * repo's own wrapper (`gradlew` through sh, or `gradlew.bat` on Windows) — with the Android SDK, the JDK the app's
 * Gradle runs on (DocaWear's 8.12 needs ≤ 23: the JDK 21 toolchain from System tools), and the hub's signing key, so
 * the APK installs over the app already on a phone. `pull` first fast-forwards the repo from its remote.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const apps = require('./index');

let _running = null;

function run(cmd, args, opts, say) {
  return new Promise(resolve => {
    say(`$ ${[cmd, ...args].join(' ')}\n`);
    const child = spawn(cmd, args, { ...opts, windowsHide: true });
    child.stdout.on('data', d => say(d.toString()));
    child.stderr.on('data', d => say(d.toString()));
    child.on('error', e => { say(`${e.message}\n`); resolve(1); });
    child.on('close', code => resolve(code ?? 1));
  });
}

async function build(app, { pull = false } = {}, say = () => {}) {
  const a = apps.known(app);
  const repo = apps.settings().apps[app].repo;
  if (!repo) throw Object.assign(new Error(`Say where ${a.label}'s repository is first (Settings → DOCA apps).`), { status: 409 });
  if (_running) throw Object.assign(new Error(`${_running} is building; one at a time.`), { status: 409 });
  _running = a.label;
  try {
    const home = os.homedir();
    const sdk = process.env.ANDROID_HOME || path.join(home, process.platform === 'darwin' ? 'Library/Android/sdk' : process.platform === 'win32' ? path.join('AppData', 'Local', 'Android', 'Sdk') : 'Android/Sdk');
    const env = { ...process.env, ANDROID_HOME: sdk, ...apps.signingEnv() };
    if (a.java) {
      const jdk = path.join(home, '.gradle', 'jdks', `temurin-${a.java}`);
      if (!fs.existsSync(jdk)) throw Object.assign(new Error(`${a.label}'s Gradle runs on Java ${a.java}: install the JDK ${a.java} toolchain (Settings → System → System tools).`), { status: 409 });
      env.JAVA_HOME = jdk;
    }
    if (!env.DOCA_SIGNING_STORE) say('Note: the hub holds no signing key, so this APK is signed with this machine\'s debug key and will not install over an app signed elsewhere.\n');
    if (pull && await run('git', ['-C', repo, 'pull', '--ff-only'], { env }, say) !== 0) throw new Error('git pull failed (see above).');
    const win = process.platform === 'win32';
    const wrapper = path.join(repo, win ? 'gradlew.bat' : 'gradlew');
    if (!fs.existsSync(wrapper)) throw new Error(`${wrapper} is missing.`);
    // sh rather than ./gradlew: a checkout on a drive without the executable bit (NTFS, a USB disk) still builds.
    const code = win ? await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${wrapper}" --no-daemon ${a.task}`], { cwd: repo, env, windowsVerbatimArguments: true }, say)
      : await run('sh', [wrapper, '--no-daemon', a.task], { cwd: repo, env }, say);
    if (code !== 0) throw new Error(`Gradle exited ${code} (see above).`);
    const out = path.join(repo, a.apk);
    if (!fs.existsSync(out)) throw new Error(`The build said it worked, but ${a.apk} is not there.`);
    // What the build file says, for when the APK cannot be read (aapt2 missing from the SDK).
    let given = {};
    try { const g = fs.readFileSync(path.join(repo, 'app', 'build.gradle.kts'), 'utf8');
      given = { versionCode: (/versionCode\s*=\s*(\d+)/.exec(g) || [])[1], versionName: (/versionName\s*=\s*"([^"]+)"/.exec(g) || [])[1] }; } catch { /* none */ }
    const meta = apps.keep(app, fs.readFileSync(out), { from: 'build', force: true, given });
    say(`✓ ${a.label} ${meta.versionName} (${meta.versionCode}) kept — devices that check will offer it.\n`);
    return meta;
  } finally { _running = null; }
}

module.exports = { build };
