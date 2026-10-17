'use strict';

/**
 * Reading the same files over and over (2026-10-17, the Emberfall run's final task: 95 calls and not one write, Menu.js
 * read 10 times, the review 10 times, five other files 5 times each — "I have the picture… let me pin down…"). A
 * cheaper model gathers again what it already holds instead of acting; the stall rule (stall.js) would only speak at 40
 * steps. Counted mechanically from the rows since the work last moved: a file read by `read_file`, or shown by `cat`,
 * `head`, `tail`, `sed -n`, `nl` or `less` in a shell call, a second time and more. At REPEATS repeated reads, one note
 * from DOCA naming them, once per stretch; the stall rule's note and report stay as they are.
 */
const REPEATS = 6;
const SHOWS = /(?:^|[;&|]\s*|\s)(?:cat|head|tail|nl|less|sed\s+-n\s+(?:'[^']*'|"[^"]*"|\S+))((?:\s+-\S+(?:\s+\d+)?)*)\s+((?:\S+\.\w{1,6}\s*)+)/g;

const argsOf = c => { try { return JSON.parse(c.function?.arguments || '{}') || {}; } catch { return {}; } };
const clean = f => String(f || '').replace(/^["']|["']$/g, '').replace(/^\.\//, '');

/** Every file the rows read, in order. */
function reads(rows) {
  const out = [];
  for (const r of rows) for (const c of r.role === 'assistant' ? r.tool_calls || [] : []) {
    const name = c.function?.name, a = argsOf(c);
    if (name === 'read_file' && a.path) out.push(clean(a.path));
    if (name === 'shell' && a.command) for (const m of String(a.command).matchAll(SHOWS)) for (const f of m[2].trim().split(/\s+/)) out.push(clean(f));
  }
  return out;
}

/** The note to append, or null: files read again REPEATS times since the work last moved, and not said yet. */
function note(rows, from) {
  if (rows.some(r => r.role === 'user' && r.reread)) return null;
  const counts = new Map();
  for (const f of reads(rows)) counts.set(f, (counts.get(f) || 0) + 1);
  const again = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  const repeats = again.reduce((sum, [, n]) => sum + n - 1, 0);
  if (repeats < REPEATS) return null;
  const named = again.slice(0, 6).map(([f, n]) => `${f} (${n}×)`).join(', ');
  return { role: 'user', from, reread: true,
    content: `[DOCA] You have read these again since the work last moved: ${named}. What they hold is already above in this `
      + 'conversation — reading them once more will not change it. Act now: make the change, run the test, or mark the step; '
      + 'if something truly blocks you, report it.' };
}

module.exports = { note, reads, REPEATS };
