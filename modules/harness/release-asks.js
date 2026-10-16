'use strict';

/**
 * Who may release unasked is decided per model (CONSTITUTION W2, modules/releasing.js) — and with a mastermind and a
 * worker (turn/model-route.js) one turn has two. Review 2026-10-16: a listed mastermind could decide a push or a tag
 * that an unlisted worker then made, each step's prompt saying only what its own model may do. So the call itself is
 * checked against the model of the step that makes it: in a routed turn, a release act (a push, a tag, a merge, a
 * release script) made by a step whose model is not listed is asked — a person's yes each time, never "always" — and
 * a mission, with nobody to ask, reports it to its leader instead. A turn on one model keeps the rule its prompt states
 * (environment.js); only the development edition, where releasing DOCA is a thing an agent does, is checked.
 * Tightens a guard (S11 asks only of a change that widens one).
 */

// Segments of a shell line that release: git push / tag (not a listing) / merge, gh release create / pr merge, a
// release script. Read over the whole text, quotes and substitutions included: a computed command is asked too.
const ACTS = [
  [/\bgit\b(?:\s+-[Cc]\s+\S+)*\s+push\b/, 'a git push'],
  [/\bgit\b(?:\s+-[Cc]\s+\S+)*\s+tag\b(?!\s+(?:-l|--list|-n|-v|--verify|--contains|--points-at)\b)(?=\s+\S)/, 'a git tag'],
  [/\bgit\b(?:\s+-[Cc]\s+\S+)*\s+merge\b(?!\s+--abort\b)/, 'a git merge'],
  [/\bgh\s+(?:release\s+create|pr\s+merge)\b/, 'a GitHub release or merge'],
  [/(?:^|[\s/;&|])release\.sh\b|\bnpm\s+run\s+release\b/, 'a release script'],
];

/** What release act a call is, or null. */
function actOf(name, args) {
  if (name !== 'shell' && name !== 'shell_job') return null;
  const text = String(args?.command || '');
  const hit = ACTS.find(([re]) => re.test(text));
  return hit ? hit[1] : null;
}

/** A forced ask for a release act by a step whose model is not listed, or null. `ctx.stepModel`: set only when routed. */
function of(name, args, ctx = {}) {
  if (!ctx.stepModel) return null;
  const what = actOf(name, args);
  if (!what) return null;
  try { if (!require('../edition-mode').development()) return null; } catch { return null; }
  let check;
  try { check = require('../releasing').check(ctx.stepModel); } catch { check = { unasked: false }; }
  if (check.unasked) return null;
  return { tool: name, keys: null, forced: true,
    summary: `${String(args?.command || '').slice(0, 200)} — ${what}, made by a step on ${ctx.stepModel}, which is not listed to release unasked `
      + '(Settings → Developer → Releasing). Asked, whatever the approval mode.',
    inMission: `Releasing is not this mission's model's to do unasked: report that ${what} is ready, and your leader or the person makes it.` };
}

module.exports = { of, actOf };
