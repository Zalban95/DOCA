# Experiment: catch an answer that claims what the turn never did

Flag `experiments.claimCheck` (Settings → Developer), off by default. Since 2.264.0. Code: `modules/harness/turn/claims.js`,
called from `agent.js` where a step answers without calling a tool. TODO B7c.

## Hypothesis

A model sometimes says it did something it did not: on the routing set (2026-10-07, fresh sandboxes) DeepSeek answered
"Written to memory as `router-ip`" and never called `memory_write`. The charter already says never to claim a result
not seen; a rule the model reads did not stop it. A check of the answer against the turn's own calls, and one more step
when they disagree, should turn most such answers into the action — or into an honest "not done" — for the price of one
step in the rare turn that needs it.

## What happens when it is on

When a step ends the turn (no tool calls) and its text claims one of these, and no call this turn could have made it:

| Claim | Calls that make it true |
|---|---|
| a memory saved ("saved to memory", "I'll remember") | `memory_write`, `memory_rules_write` |
| a reminder or schedule set | `remind`, `schedule`, `recipe` |
| a setting proposed or changed | `settings_propose`, `form_fill` |
| an install proposed | `install_propose`, `hub_command` |
| a commit or a push | `git`, `shell`, `project` |
| a message sent to a device | `tell_device`, `ask_device` |

— and the turn holds at least one of those tools (otherwise the sentence is about a limit, not a missing call), the
turn goes on for one more step. The transcript gets a row from DOCA (not the person): "Your answer says …, but nothing
this turn did that — no call to …. Do it now, or tell the person plainly that it was not done." The panel shows a
warning with `kind: 'claim'`. Once per turn, and never on the last allowed step.

## Measured

How: `npm run eval -- routing --models <provider/model> --flag claimCheck` (the `remember` case is the one that caught
it), and the turns' warnings of kind `claim` in the logs over a week of ordinary use — each one either fixed an answer
(the next step made the call or said "not done") or was a false alarm (the answer described something else).

| date | model | flag | remember case | claim warnings | false alarms | notes |
|---|---|---|---|---|---|---|

## Cost and risks

- One more step, only in a turn whose answer claims something unmade: its whole prompt again (the cached prefix makes
  most of it cheap).
- False alarms: an answer quoting what the person did ("you pushed it yesterday") or describing a plan reads like a
  claim. The patterns ask for the first person or a past-tense action near its object; the measurement counts the rest.
- The person sees the first answer stream, then the correction: the answer is longer, never silently replaced.

## Rollback

Switch the flag off. Failing removes `turn/claims.js` and its four lines in `agent.js`.
