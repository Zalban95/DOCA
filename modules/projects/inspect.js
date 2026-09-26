'use strict';

/**
 * What a project is, from its files: which kinds of build it has, the commands
 * that build, test, lint and run it, and whether the tools those commands need
 * are on this machine.
 *
 * Read from the tree every time, never stored: a project that gains a
 * build.gradle becomes an Android project the next time it is looked at. The
 * commands are the ones the project itself declares where it declares any
 * (package.json scripts, a Gradle wrapper, a Makefile), else the standard ones
 * for its kind. A command whose tool is missing is still listed — with what is
 * missing — because "this is how it builds, and here is what to install" is
 * more use than silence.
 */
const fs   = require('fs');
const path = require('path');

const { detect } = require('../detect');

const exists = (root, ...p) => fs.existsSync(path.join(root, ...p));
const read = (root, f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
const WIN = process.platform === 'win32';

/** A command: what to run, and which toolchains it needs. */
const cmd = (name, run, needs = [], what = '') => ({ name, run, needs, what });

function nodeKind(root) {
  if (!exists(root, 'package.json')) return null;
  let pkg = {};
  try { pkg = JSON.parse(read(root, 'package.json')); } catch {}
  const pm = exists(root, 'pnpm-lock.yaml') ? 'pnpm' : exists(root, 'yarn.lock') ? 'yarn' : exists(root, 'bun.lockb') ? 'bun' : 'npm';
  const run = s => (pm === 'npm' ? `npm run ${s}` : `${pm} ${s}`);
  const scripts = Object.keys(pkg.scripts || {});
  const commands = [cmd('install', pm === 'npm' ? 'npm install' : `${pm} install`, [pm], 'install the dependencies')];
  for (const s of scripts) commands.push(cmd(s === 'test' ? 'test' : s, s === 'test' && pm === 'npm' ? 'npm test' : run(s), [pm], pkg.scripts[s].slice(0, 120)));
  return { kind: 'node', label: `Node.js (${pm})`, commands };
}

function androidKind(root) {
  const gradle = ['build.gradle', 'build.gradle.kts', 'app/build.gradle', 'app/build.gradle.kts'].map(f => read(root, f)).join('\n');
  if (!/com\.android\.(application|library)|android\s*\{/.test(gradle)) return null;
  const gw = exists(root, WIN ? 'gradlew.bat' : 'gradlew') ? (WIN ? 'gradlew.bat' : './gradlew') : 'gradle';
  const needs = ['java', 'android-sdk', ...(gw === 'gradle' ? ['gradle'] : [])];
  return {
    kind: 'android', label: 'Android (Gradle)',
    commands: [
      cmd('build', `${gw} assembleDebug`, needs, 'build the debug APK'),
      cmd('test', `${gw} testDebugUnitTest`, needs, 'unit tests on the JVM'),
      cmd('lint', `${gw} lintDebug`, needs, 'Android lint'),
      cmd('install', `${gw} installDebug`, [...needs, 'adb'], 'install on the connected device or emulator'),
      cmd('device-test', `${gw} connectedDebugAndroidTest`, [...needs, 'adb'], 'instrumented tests on a device'),
      cmd('release', `${gw} assembleRelease`, needs, 'release APK (needs signing config)'),
      cmd('devices', 'adb devices -l', ['adb'], 'connected devices and emulators'),
    ],
    apk: 'app/build/outputs/apk/debug/',
  };
}

function gradleKind(root) {
  if (!['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some(f => exists(root, f))) return null;
  const gw = exists(root, WIN ? 'gradlew.bat' : 'gradlew') ? (WIN ? 'gradlew.bat' : './gradlew') : 'gradle';
  const needs = ['java', ...(gw === 'gradle' ? ['gradle'] : [])];
  return { kind: 'gradle', label: 'Gradle (JVM)', commands: [cmd('build', `${gw} build`, needs), cmd('test', `${gw} test`, needs), cmd('clean', `${gw} clean`, needs)] };
}

const SIMPLE = [
  ['pom.xml', 'maven', 'Maven (Java)', [cmd('build', 'mvn -q package', ['java', 'maven']), cmd('test', 'mvn -q test', ['java', 'maven'])]],
  ['Cargo.toml', 'rust', 'Rust (Cargo)', [cmd('build', 'cargo build', ['cargo']), cmd('test', 'cargo test', ['cargo']), cmd('lint', 'cargo clippy', ['cargo']), cmd('run', 'cargo run', ['cargo'])]],
  ['go.mod', 'go', 'Go', [cmd('build', 'go build ./...', ['go']), cmd('test', 'go test ./...', ['go']), cmd('lint', 'go vet ./...', ['go'])]],
  ['pubspec.yaml', 'flutter', 'Flutter / Dart', [cmd('build', 'flutter build apk --debug', ['flutter']), cmd('test', 'flutter test', ['flutter']), cmd('lint', 'flutter analyze', ['flutter'])]],
];

function pythonKind(root) {
  if (!['pyproject.toml', 'setup.py', 'requirements.txt'].some(f => exists(root, f))) return null;
  const commands = [];
  if (exists(root, 'requirements.txt')) commands.push(cmd('install', 'python3 -m pip install -r requirements.txt', ['python']));
  commands.push(cmd('test', 'python3 -m pytest', ['python'], 'pytest'));
  if (/\[tool\.ruff/.test(read(root, 'pyproject.toml'))) commands.push(cmd('lint', 'ruff check .', ['ruff']));
  if (exists(root, 'pyproject.toml')) commands.push(cmd('build', 'python3 -m build', ['python']));
  return { kind: 'python', label: 'Python', commands };
}

function dotnetKind(root) {
  let files = [];
  try { files = fs.readdirSync(root); } catch {}
  if (!files.some(f => /\.(sln|csproj|fsproj)$/.test(f))) return null;
  return { kind: 'dotnet', label: '.NET', commands: [cmd('build', 'dotnet build', ['dotnet']), cmd('test', 'dotnet test', ['dotnet'])] };
}

function makeKind(root) {
  if (exists(root, 'CMakeLists.txt')) {
    return { kind: 'cmake', label: 'CMake', commands: [
      cmd('configure', 'cmake -S . -B build', ['cmake']), cmd('build', 'cmake --build build', ['cmake']),
      cmd('test', 'ctest --test-dir build', ['cmake'])] };
  }
  if (!exists(root, 'Makefile')) return null;
  const targets = [...read(root, 'Makefile').matchAll(/^([A-Za-z][\w-]*):/gm)].map(m => m[1]).filter((t, i, a) => a.indexOf(t) === i).slice(0, 12);
  return { kind: 'make', label: 'Make', commands: [cmd('build', 'make', ['make']), ...targets.filter(t => t !== 'all').map(t => cmd(t, `make ${t}`, ['make']))] };
}

/** How each toolchain a command may need is found (modules/detect.js specs). */
const TOOLCHAINS = {
  npm: { bin: 'npm', args: ['--version'] }, pnpm: { bin: 'pnpm', args: ['--version'] },
  yarn: { bin: 'yarn', args: ['--version'] }, bun: { bin: 'bun', args: ['--version'] },
  java: { bin: 'java', args: ['-version'], stderr: true },
  gradle: { bin: 'gradle', args: ['--version'], match: /^Gradle/ },
  maven: { bin: 'mvn', args: ['-v'] },
  adb: { any: [{ bin: 'adb', args: ['version'] }, ...sdkBins('platform-tools/adb', ['version'])] },
  'android-sdk': { any: sdkRoots().map(r => ({ file: path.join(r, 'platform-tools', WIN ? 'adb.exe' : 'adb') })) },
  cargo: { bin: 'cargo', args: ['--version'] }, go: { bin: 'go', args: ['version'] },
  flutter: { bin: 'flutter', args: ['--version'] },
  python: { any: [{ bin: 'python3', args: ['--version'] }, { bin: 'python', args: ['--version'] }] },
  ruff: { bin: 'ruff', args: ['--version'] }, dotnet: { bin: 'dotnet', args: ['--version'] },
  cmake: { bin: 'cmake', args: ['--version'] }, make: { bin: 'make', args: ['--version'] },
  git: { bin: 'git', args: ['--version'] },
};

/** Where an Android SDK usually is: the environment, then Android Studio's defaults. */
function sdkRoots() {
  const home = require('os').homedir();
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(home, 'Android', 'Sdk'),
    path.join(home, 'Library', 'Android', 'sdk'), path.join(home, 'AppData', 'Local', 'Android', 'Sdk')].filter(Boolean);
}
function sdkBins(rel, args) { return sdkRoots().map(r => ({ bin: path.join(r, rel + (WIN ? '.exe' : '')), args })); }

async function toolchains(names) {
  const out = {};
  await Promise.all([...new Set(names)].map(async n => {
    const r = TOOLCHAINS[n] ? await detect(TOOLCHAINS[n]) : { detected: false, version: null };
    out[n] = { detected: r.detected, version: r.version };
  }));
  const sdk = sdkRoots().find(r => fs.existsSync(r));
  if (out['android-sdk']) out['android-sdk'].path = sdk || null;
  return out;
}

/**
 * Everything the panel and the agent need to know to work in `root`:
 * { kinds: [{ kind, label, commands }], commands: [{ name, run, needs, missing, what, kind }], toolchains }.
 */
async function inspect(root) {
  const kinds = [androidKind(root), androidKind(root) ? null : gradleKind(root), nodeKind(root), pythonKind(root), dotnetKind(root), makeKind(root),
    ...SIMPLE.map(([f, kind, label, commands]) => (exists(root, f) ? { kind, label, commands } : null))].filter(Boolean);
  const tc = await toolchains(kinds.flatMap(k => k.commands.flatMap(c => c.needs)));
  // One list of commands, first kind first. A name two kinds share (an Android
  // app with a package.json both have "test") keeps the plain name for the
  // first and is "<kind>:<name>" for the rest, so every one stays runnable.
  const seen = new Set(), commands = [];
  for (const k of kinds) for (const c of k.commands) {
    const name = seen.has(c.name) ? `${k.kind}:${c.name}` : c.name;
    if (seen.has(name)) continue;
    seen.add(name);
    commands.push({ ...c, name, kind: k.kind, missing: c.needs.filter(n => !tc[n]?.detected) });
  }
  return { kinds: kinds.map(({ kind, label, apk }) => ({ kind, label, ...(apk ? { apk } : {}) })), commands, toolchains: tc };
}

module.exports = { inspect, sdkRoots, TOOLCHAINS };
