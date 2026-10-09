'use strict';

/**
 * Which processes on this machine are work worth a line in the Workstream (asked 2026-10-10: "Still nothing
 * automatically on Live or Workstream" while agents outside DOCA edited the repositories, ran tests and emulators). Pure:
 * a process row (processes/read-*.js) in, a kind and a label out — or null. Fixed rules on the program's name and
 * arguments; no model is asked anything.
 *   agent     an agent's session on the command line: Claude Code, Codex, Cursor's agent, Aider, Gemini, Copilot, Amp,
 *             OpenCode, Goose, Qwen Code, Crush
 *   build     a build or a test run: npm/pnpm/yarn/bun test·build·ci·run, node --test, Gradle, docker build, cargo,
 *             make, go, pytest, Maven, dotnet, tsc, vite, jest, vitest
 *   emulator  an Android emulator (its QEMU with -avd, or the emulator launcher)
 *   browser   a headless browser (a test run's, a sweep's)
 *   editor    an editor or IDE — named only to say who may have written a file, never a line of its own
 */
const AGENTS = { claude: 'Claude Code', codex: 'Codex', 'cursor-agent': 'Cursor\'s agent', aider: 'Aider', gemini: 'Gemini CLI', copilot: 'Copilot CLI',
  amp: 'Amp', opencode: 'OpenCode', goose: 'Goose', qwen: 'Qwen Code', crush: 'Crush' };
const EDITORS = /^(code|code-insiders|cursor|codium|nvim|vim|vi|emacs|subl|sublime_text|zed|idea|studio|android-studio|gedit|kate|nano|micro|helix|hx)$/;
const base = s => String(s || '').split(/[\\/]/).pop().replace(/\.(exe|cmd|js|mjs|cjs)$/i, '');

/** The program a process runs: its name, or the script node/python runs (`node /usr/bin/gemini` is Gemini). */
function program(p) {
  const a = p.args || [];
  const first = base(a[0] || p.name);
  if (/^(node|nodejs|bun|deno|python3?|python)$/.test(first) && a[1] && !a[1].startsWith('-')) return base(a[1]);
  return first || base(p.name);
}

const short = (args, n = 80) => {
  const a = [...(args || [])];
  a[0] = base(a[0]);
  return a.join(' ').replace(/\s+/g, ' ').slice(0, n);
};

function kindOf(p) {
  const a = p.args || [], prog = program(p), name = String(p.name || ''), line = a.join(' ');
  if (AGENTS[prog]) return { kind: 'agent', label: `${AGENTS[prog]} session`, what: short(a) };
  if (/^qemu-system/.test(name) || /^qemu-system/.test(base(a[0]))) {
    const i = a.indexOf('-avd');
    if (i >= 0 || /android|emulator/i.test(line)) return { kind: 'emulator', label: 'Android emulator', what: i >= 0 ? a[i + 1] : 'emulator' };
    return null;   // a VM: Machines → VMs has it
  }
  if (/^emulator\d*$/.test(prog) && a.includes('-avd')) return { kind: 'emulator', label: 'Android emulator', what: a[a.indexOf('-avd') + 1] || 'emulator' };
  if (/chrom(e|ium)|headless_shell|msedge|firefox/i.test(prog) && a.some(x => /^--headless/.test(x)) && !a.some(x => /^--type=/.test(x)))
    return { kind: 'browser', label: 'Headless browser', what: short(a.filter(x => !/^--/.test(x)), 60) || 'headless' };
  const sub = a.slice(1).filter(x => !x.startsWith('-'));
  if (/^(npm|pnpm|yarn|bun|npx)$/.test(prog) && sub.some(x => /^(test|t|build|ci|install|run|exec|lint|smoke)$/.test(x))) return { kind: 'build', label: 'Build or test', what: short(a) };
  if (/^(node|nodejs)$/.test(prog) && a.includes('--test')) return { kind: 'build', label: 'Tests', what: short(a) };
  if (/^(gradle|gradlew)$/.test(prog) || (prog === 'java' && a.some(x => /GradleWrapperMain|gradle-launcher/.test(x)))) return { kind: 'build', label: 'Gradle build', what: short(a.filter(x => !/^-D|^-X|\.jar$|^-cp$|^-classpath$/.test(x) && !/[\\/]/.test(x)), 80) };
  if (prog === 'docker' && (sub[0] === 'build' || (sub[0] === 'buildx' && sub[1] === 'build') || (sub[0] === 'compose' && sub.includes('build')))) return { kind: 'build', label: 'Docker build', what: short(a) };
  if ((prog === 'cargo' && /^(build|test|run|check)$/.test(sub[0] || '')) || (prog === 'go' && /^(build|test)$/.test(sub[0] || ''))
    || /^(make|pytest|py\.test|mvn|tsc|jest|vitest)$/.test(prog) || (prog === 'dotnet' && /^(build|test|publish)$/.test(sub[0] || ''))
    || (prog === 'vite' && sub[0] === 'build')) return { kind: 'build', label: 'Build or test', what: short(a) };
  if (EDITORS.test(prog)) return { kind: 'editor', label: 'Editor', what: prog };
  return null;
}

module.exports = { kindOf, program, short, AGENTS };
