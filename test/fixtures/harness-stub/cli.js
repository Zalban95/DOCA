#!/usr/bin/env node
'use strict';
// A stand-in for `claude -p … --output-format stream-json` (test/harness-teams.test.js): it checks it was run headless
// with its approvals off, says what it does in Claude Code's stream-json shape, edits a file, commits, posts a note for
// its teammates to the file its preamble names, and ends with a result. It never prints its API key, only whether it has one.
const { execFileSync } = require('child_process');
const fs = require('fs');
const out = o => process.stdout.write(`${JSON.stringify(o)}\n`);
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'status') process.exit(fs.existsSync(`${process.env.HOME}/.stub-signed-in`) ? 0 : 1);
const task = args[args.length - 1];
if (!args.includes('-p') || args[args.indexOf('--permission-mode') + 1] !== 'bypassPermissions') { out({ type: 'result', subtype: 'error', is_error: true, result: 'not headless with approvals off' }); process.exit(2); }
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'default';
const branch = /on the branch (\S+?), which is yours/.exec(task)?.[1] || '?';
const notes = /append one short line to (\S+?)\.(?:\n|$)/.exec(task)?.[1];
const id = (/## Your task\n([^\n]*)/.exec(task)?.[1] || 'work').replace(/[^\w]+/g, '-').slice(0, 30);
out({ type: 'system', subtype: 'init', model });
const cmd = `echo stub > STUB-${id}.md`;
out({ type: 'assistant', message: { content: [{ type: 'text', text: `Working on ${branch} with ${model}.` }, { type: 'tool_use', name: 'Bash', input: { command: cmd } }] } });
fs.writeFileSync(`STUB-${id}.md`, `stub ${model} key:${process.env.ANTHROPIC_API_KEY ? 'present' : 'absent'}\n`);
out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok', is_error: false }] } });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: `STUB-${id}.md`, content: 'x' } }] } });
execFileSync('git', ['add', '-A']); execFileSync('git', ['commit', '-q', '-m', `Stub work: ${id}`]);
if (notes) fs.appendFileSync(notes, `the stub file is STUB-${id}.md\n`);
const slow = /## Your task\nSLOW/.test(task);
const end = () => { out({ type: 'result', subtype: 'success', is_error: false, result: `Done: wrote STUB-${id}.md on ${branch}. Nothing is left.`, total_cost_usd: 0 }); };
if (slow) setTimeout(end, 120000); else end();
