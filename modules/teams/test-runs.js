'use strict';

/**
 * A task's own runs of its test, read from its transcript (a team's task is done when its last run of its test passed;
 * tries-score.js). Models run a test the way people do, and on 2026-10-17 a team's ten members used every one of these
 * ways — the hub counted none, since it read only a bare `npm test` typed into the shell; it sent each back to run its
 * test, then retried them, and gave four up with their work done and green. What counts as a run now:
 *
 *   - a `shell` call whose command, after a leading `cd <its own folder> &&` (or `;`), `VAR=value` settings and
 *     `timeout N`, is exactly the test, maybe followed by output redirections — its exit code is the verdict;
 *   - the same piped into one filter (`| tail -80`, `| head`, `| grep x`): the pipe's exit code is the filter's, so the
 *     verdict is the summary the test runner printed (node's `# fail 0`, jest and vitest, pytest, mocha, cargo, go,
 *     npm's "Test failed"); with no summary in the output it is not a run;
 *   - `project` run of the project's named command whose line is the test ("npm test — exited (exit 1)");
 *   - a `shell_job` that ran it, when the job's end is reported ("job_… — exited (exit 0) — started … — <command>").
 *
 * A `cd` into another folder, a chain (`&&`, `||`, `;`), extra arguments or a background `&` still say nothing about the
 * test. A write after the last run (a file tool) makes it not known again. Mechanical: no model, no command run here.
 */
const path = require('path');

const norm = c => String(c ?? '').trim().replace(/\s+/g, ' ');
/** Only output redirections: `> f`, `>> f`, `2>&1`, `&> f`, `2>/dev/null`. */
const REDIRECTS = /^(?:\s*(?:\d?>>?|&>>?)\s*(?:&\d|[^\s|;&<>()`$]+))*\s*$/;
/** One filter after the pipe, which reads the output and changes nothing. */
const FILTER = /^\|\s*(?:tail|head|grep|cat|less|more|tee|cut)\b[^|;&<>`$]*$/;
const WRITES = new Set(['write_file', 'replace_in_files', 'edit_file']);

const unquote = s => s.replace(/^(["'])(.*)\1$/, '$2');

/**
 * The command with what only places it taken off; null when it moves into a folder other than `root`. `keepEnv`: the
 * test itself sets something (`GAME_PLAN=full npm test`), so a run without that setting is not a run of it.
 */
function core(command, root = null, keepEnv = false) {
  let c = norm(command);
  for (let prev; prev !== c;) {
    prev = c;
    const cd = /^cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/.exec(c);
    if (cd) {
      if (!root) return null;
      const to = path.resolve(root, unquote(cd[1]).replace(/^~(?=$|\/)/, require('os').homedir()));
      if (path.resolve(to) !== path.resolve(root)) return null;
      c = c.slice(cd[0].length);
    }
    if (!keepEnv) c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;&|]*)\s+)+/, '');
    c = c.replace(/^timeout\s+(?:-\S+\s+)*\d+[smhd]?\s+/, '');
  }
  return c;
}

/** 'exact' when `command` runs exactly the test (redirections aside), 'piped' through one filter, else null. */
function shape(command, test, root = null) {
  const keepEnv = /^[A-Za-z_][A-Za-z0-9_]*=/.test(norm(test));
  const want = norm(test), cmd = core(command, root, keepEnv);
  if (!want || !cmd || !cmd.startsWith(want)) return null;
  const rest = cmd.slice(want.length);
  if (rest && !/^\s/.test(rest) && !/^[&\d]?>/.test(rest)) return null;   // `npm tests`
  const pipe = rest.search(/\|/);
  if (pipe < 0) return REDIRECTS.test(rest) ? 'exact' : null;
  return REDIRECTS.test(rest.slice(0, pipe)) && FILTER.test(rest.slice(pipe).trim()) ? 'piped' : null;
}

/** A command line cut at its top-level `&&`, `||` and `;` (quotes respected): [{text, before}] — `before` the operator ahead of it. */
function chain(command) {
  const out = [];
  let cur = '', q = null, before = null;
  const s = String(command || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q && s[i - 1] !== '\\') q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||' || ch === ';' || ch === '\n') {
      out.push({ text: cur.trim(), before });
      before = two === '&&' || two === '||' ? two : ';';
      cur = '';
      if (two === '&&' || two === '||') i++;
      continue;
    }
    cur += ch;
  }
  out.push({ text: cur.trim(), before });
  return out.filter(p => p.text);
}

/**
 * The test run inside a chain (`node scripts/plan.js && npm test 2>&1 | tail -8; echo done`, 2026-10-18: members chain
 * a preparation before it and an echo after): { last, piped } when one segment runs the test, nothing masks it with
 * `||`, and every `cd` before it goes to the task's own folder; else null.
 */
function inChain(command, test, root = null) {
  const parts = chain(command);
  if (parts.length < 2) return null;
  const i = parts.findIndex(p => shape(p.text, test, root));
  if (i < 0) return null;
  if (parts[i].before === '||' || parts[i + 1]?.before === '||') return null;
  for (const p of parts.slice(0, i)) {
    const cd = /^cd\s+("[^"]*"|'[^']*'|\S+)\s*$/.exec(p.text);
    if (cd && (!root || path.resolve(root, unquote(cd[1])) !== path.resolve(root))) return null;
  }
  return { last: i === parts.length - 1, piped: shape(parts[i].text, test, root) === 'piped' };
}

/** 0 passed, 1 failed, from the summary a test runner prints; null when the output has none. */
const SUMMARIES = [
  o => { const f = /^\s*(?:#|ℹ) fail (\d+)/m.exec(o), p = /^\s*(?:#|ℹ) pass (\d+)/m.exec(o); return f ? (Number(f[1]) > 0 ? 1 : p && Number(p[1]) > 0 ? 0 : null) : null; },   // node --test
  o => (/^\s*Tests:?\s+.*\b\d+ failed/m.test(o) ? 1 : /^\s*Tests:?\s+(?:.*,\s*)?\d+ passed/m.test(o) ? 0 : null),   // jest, vitest
  o => (/^=+ .*\b\d+ (?:failed|errors?)\b.*=+\s*$/m.test(o) ? 1 : /^=+ .*\b\d+ passed\b.*=+\s*$/m.test(o) ? 0 : null),   // pytest
  o => (/^\s*\d+ failing\b/m.test(o) ? 1 : /^\s*\d+ passing\b/m.test(o) ? 0 : null),   // mocha
  o => (/^test result: FAILED\b/m.test(o) ? 1 : /^test result: ok\b/m.test(o) ? 0 : null),   // cargo
  o => (/^(?:--- )?FAIL\b/m.test(o) ? 1 : /^ok\s+\S+\s+[\d.]+s/m.test(o) ? 0 : null),   // go test
  o => (/npm (?:ERR!|error) (?:Test failed|code ELIFECYCLE)/.test(o) ? 1 : null),
];
function verdictOf(output) {
  const o = String(output || '');
  for (const s of SUMMARIES) { const v = s(o); if (v != null) return v; }
  return null;
}

const argsOf = c => { try { return JSON.parse(c?.function?.arguments || '{}'); } catch { return {}; } };

/**
 * Whether a shell line may change the work (so a test run before it no longer proves the work): anything but commands
 * that only read or record — ls, cat, grep, find without -delete/-exec, git status/log/diff/show/add/commit… — and no
 * redirect into a file. Errs towards "may": the cost is one more run of the test. (2026-10-17: a member regenerated its
 * levels with a script after a failing run, never ran the test again, and reported green.)
 */
const READ_ONLY = /^(?:ls|ll|cat|head|tail|less|more|grep|egrep|fgrep|rg|wc|echo|printf|pwd|which|type|stat|file|du|df|diff|sort|uniq|cut|tr|nl|date|true|false|sleep|cd|test|\[|env|printenv|tree|basename|dirname|realpath|readlink|jq|node\s+--check|sed\s+-n|awk\s+'[^']*'(?:\s+\S+)*$|find(?![^|;&]*(?:-delete|-exec|-ok))|git\s+(?:status|log|diff|show|add|commit|branch|rev-parse|ls-files|stash\s+list|remote|config\s+--get))\b/;
function mayChange(command, test) {
  const line = String(command || '').replace(/\\\n/g, ' ');
  if (/(^|[^0-9&>])>{1,2}\s*(?!\/dev\/null|&\d)\S/.test(line.replace(/2>&1/g, ''))) return true;   // a redirect into a file
  return chain(line).flatMap(p => p.text.split('|')).map(x => x.trim()).filter(Boolean).some(seg => {
    if (test && shape(seg, test)) return false;
    const bare = seg.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '').replace(/^(?:timeout\s+\d+[smhd]?\s+|sudo\s+)/, '');
    return !READ_ONLY.test(bare);
  });
}

/** Every command a hub conversation ran, in order — `[{command, code, output, changes}]` — from its own rows. */
function fromRows(rows, test = null) {
  const calls = new Map(), runs = [];
  for (const r of rows) {
    if (r.role === 'assistant') for (const c of r.tool_calls || []) {
      const name = c.function?.name, a = argsOf(c);
      calls.set(c.id || name, { name, a });
      if (WRITES.has(name)) runs.push({ command: '', code: null, changes: true });
    }
    if (r.role !== 'tool') continue;
    const c = calls.get(r.tool_call_id) || { name: r.name, a: {} };
    const out = String(r.content || '');
    if (c.name === 'shell' && !c.a.background) {
      const m = /^exit (-?\d+)/.exec(out);
      if (m || /^(Timed out|Not finished)/.test(out)) runs.push({ command: String(c.a.command || ''), code: m ? Number(m[1]) : null, output: out,
        changes: mayChange(c.a.command, test) });   // a refused call is no run; one that may have changed files makes an earlier run stale
    } else if (c.name === 'project' && c.a.action === 'run') {
      const m = /^(.+?) — [\w ]+?(?: \(exit (-?\d+)\))?\n/.exec(`${out}\n`);
      if (m && !/still running/.test(m[0])) runs.push({ command: m[1], code: m[2] != null ? Number(m[2]) : null, output: out });
    } else if (c.name === 'shell_job') {
      const m = /^job_\w+ — [\w ]+?(?: \(exit (-?\d+)\))? — started \S+ — (.+)$/m.exec(out);
      if (m && m[1] != null) runs.push({ command: m[2], code: Number(m[1]), output: out });
    }
  }
  return runs;
}

/**
 * The test's verdict from commands in order — `[{command, code, output?, changes?}]`. The last run of the test decides,
 * unless a change came after it. `root`: the folder the task works in (a `cd` into it still counts).
 */
function verdict(test, runs, where = '', { root = null } = {}) {
  const want = norm(test);
  let last = -1, code = null, piped = false;
  runs.forEach((r, i) => {
    const s = shape(r.command, want, root);
    if (s === 'exact') { last = i; code = r.code; piped = false; return; }
    if (s === 'piped') { const v = verdictOf(r.output); if (v != null) { last = i; code = v; piped = true; } return; }
    const c = inChain(r.command, want, root);   // in a chain: the runner's summary, else the exit when it ran last
    if (!c) return;
    const v = verdictOf(r.output);
    if (v != null) { last = i; code = v; piped = true; } else if (c.last && !c.piped) { last = i; code = r.code; piped = false; }
  });
  if (last < 0) return { state: 'unknown', why: `\`${want}\` was never run${where}` };
  if (runs.slice(last + 1).some(r => r.changes && !shape(r.command, want, root) && !inChain(r.command, want, root))) return { state: 'unknown', why: `\`${want}\` was last run before a later change` };
  if (code === 0) return { state: 'passed', why: `\`${want}\` passed` };
  if (piped) return { state: 'failed', why: `\`${want}\` failed (its runner's summary)` };
  return { state: 'failed', why: code == null ? `\`${want}\` did not finish` : `\`${want}\` exited ${code}` };
}

module.exports = { core, shape, inChain, chain, verdictOf, fromRows, verdict, mayChange };
