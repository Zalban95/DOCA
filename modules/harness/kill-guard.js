'use strict';

/**
 * Killing by a name pattern, refused on the hub's own shell. `pkill -f <words>` matches every command line holding
 * those words — the agent's own shell (whose line holds the pattern), its tools, the hub itself — so it ends what it
 * did not mean to: on 2026-10-09 a pattern kill took the live hub down; on 2026-10-17 two agents in one run killed their
 * own shells with `pkill`. Finding the PID first and killing that number is the same work done safely, so the refusal
 * says how. Only this machine's shell: an agents' computer is a container of its own, where a slip harms nothing else.
 * Mechanical, from the command line's words; a person in the Terminal is not checked.
 */
// Where a command starts: the line's start, after ; & | ( or a shell keyword, or after sudo/xargs/exec.
const AT = String.raw`(?:^|[;&|(\n]\s*|\b(?:do|then|else|sudo|xargs|exec|nohup|timeout\s+\S+)\s+)`;
const PATTERNS = [
  new RegExp(`${AT}(?:sudo\\s+)?(?:pkill|killall5?)\\b`),           // pkill / killall as a command
  /\$\(\s*(?:pgrep|pidof)\b|`\s*(?:pgrep|pidof)\b/,                  // a PID list made from a name …
  /\b(?:pgrep|pidof)\b[^;&\n]*\|\s*(?:sudo\s+)?xargs\b/,             // … or piped into xargs
];
const KILL = new RegExp(`${AT}(?:sudo\\s+)?kill\\b`);   // … and kill as a command on the same line

/** A sentence when `command` kills by a name pattern, else null. */
function refusal(command) {
  const line = String(command || '');
  const named = PATTERNS[0].test(line) || ((PATTERNS[1].test(line) || PATTERNS[2].test(line)) && KILL.test(line));
  if (!named) return null;
  return 'Not run: killing processes by a name pattern can match this very shell, other tools or the hub itself. '
    + 'Find the process first (pgrep -a <name>, or ps -eo pid,args | grep <name>), check it is yours, then kill <pid>; '
    + 'a background job you started stops with shell_job stop.';
}

module.exports = { refusal, PATTERNS, KILL };
