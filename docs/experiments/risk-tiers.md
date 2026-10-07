# Experiment: as much as possible, at the lowest risk

Flag `experiments.riskTiers` (Settings → Developer), off by default, and like every experiment in effect only with
developer mode. Since 2.296.0. Code: `modules/harness/risk/` (`rules.js` the table, `classify.js` reading it, `index.js` what a turn
does with the tier), called from `turn/tool-calls.js` and `approval.gate`. TODO H10.11, asked by the owner 2026-10-06.

## Hypothesis

Auto mode runs every call; Manual asks about every call that does something. Neither matches what a person actually
worries about: a write inside a project that a checkpoint can undo is no risk, while one `git push --force`, a mail
sent or a folder deleted outside any project cannot be taken back. If every call is put in one of three tiers — and the
tier, with its way back, is said wherever the call is seen — the agent can be left to do everything that can be undone
without being asked, and asked only about the few calls that cannot. The classifier is declarative (a tool and its
arguments, a command's verbs), so it can be read, tested and measured without a model.

## What happens when it is on

Every tool call is classified before it runs:

| Tier | What it covers | What happens |
|---|---|---|
| **read** | reads and lookups: the free tools, `read_file`, `list_dir`, `search_files`, GET requests, `git status/log/diff`, a shell line whose every verb only reads (`ls`, `cat`, `grep`, `git log` …), an MCP tool marked `readOnlyHint` | runs |
| **reversible** | a change with a way back, or one that stays in the hive: writing a file (kept under `.doca/harness/backups/`), anything inside a project (a checkpoint is taken first), settings and installs (proposals a person accepts; a saved setting is checkpointed), memory (it keeps the last three values), an agents' computer (disposable, not this machine), a note to the person's own devices, a plain `git push` (the remote keeps the old commits) | runs — **after an automatic checkpoint** when the conversation is bound to a project and the call touches files (`shell`, `write_file`, `replace_in_files`, `git`, `project run/restore/worktree_remove`); the checkpoint's id is the way back |
| **outward** | it leaves the hive or cannot be undone: deleting outside a project (`rm`, `Remove-Item`, `find -delete`, `git clean`), rewriting a remote's history (`git push --force`, `-f`, `+ref`, `--delete`), a request that sends data to an address the owner does not own (`curl -X POST`, `-d`, `-F`, `api_call` or a connector with a method other than GET), mail, publishing (`npm publish`, `docker push`, `gh release`), stopping the machine, `secret_use`, `computer_login`, an MCP tool marked `destructiveHint` or open-world and not read-only, or named for sending, paying, deleting or submitting | **asked, in every mode** — Auto, Manual and Unattended — with no "always": the card names the tier, why and that there is no way back once it runs. A mission is refused, as for every question it cannot put to anybody |

**Unattended still asks for outward calls.** Unattended is the owner's switch for a test bench, and what it promises
is that proposals apply without a click; the owner asked that what cannot be undone be asked "even in Auto", and the
safest reading of that is everywhere. A question nobody answers withdraws itself after five minutes and the agent is
told to say what it meant to do, exactly as in Manual.

A call can be in a higher tier because of one part of it: `ls && rm -rf /srv/x` is outward. A command DOCA cannot
reduce to verbs (`$(…)`, backticks, a redirect into a file — `approval.verbsOf` returns null) is matched on its
segments (what a substitution runs is a segment of its own) and is never a read. A word that runs the next one
(`xargs rm`, `nohup`, `timeout 10`) is looked through; `ssh host <command>` classifies the command, outward when it
changes something on a machine the owner does not own (loopback, the LAN and the tailnet are the owner's —
`toolbox/http.owned`, the rule `api_call` already follows).

The tier is seen in four places, so the way back is always visible:

- the **trace** — each tool span carries `tier` and `way` (OTLP attributes `doca.risk.tier`, `doca.risk.way`);
- the **Workstream** — the activity line of a call shows its tier and way back;
- the **approval card** (and the watch's copy of it) — the summary says the tier and why;
- the **agent's own prompt** — one short block says that outward calls are asked and that untested work belongs in an
  agents' computer where one is at hand, so it plans for the question instead of meeting it.

Nothing is removed: the control plane, forced asks, the level's asks, outside-text re-asks and Manual mode all still ask
exactly as before. The tiers only add questions, and only while the flag is on.

## Measured

How: `npm run experiment -- risk-tiers` classifies a fixed, labelled list of representative calls
(`bin/lib/risk-cases.js`: shell lines, file tools, requests, git, ssh, MCP tools with and without annotations) with no
model, and prints a row — how many were put in the tier they were labelled, the precision and recall of **outward**
(an outward call missed is the costly error; a reversible call asked is only a nuisance), and the ones it got wrong.
Over real use: the trace's tool spans by tier for a week, and how many outward questions a person answered "deny".

| date | cases | right | outward precision | outward recall | wrong |
|---|---|---|---|---|---|
| 2026-10-07 | 73 | 72 | 1.00 | 0.96 | `python3 -c "…shutil.rmtree('/home/me/photos')"` read as reversible: a language's own delete is not a verb |

The list was written by the classifier's author, so a full score on it says the patterns cover what was thought of,
not what was not: it is the regression check, and the known misses stay in it labelled honestly. The real measure is
the week of use.

## Cost and risks

- A project checkpoint before each file-touching call in a project: `git write-tree` on the shadow repository, skipped
  when nothing changed. Milliseconds on a small project, seconds on a large one — measured in the trace's tool spans.
- **False outward** asks a person about something harmless; **missed outward** runs something irreversible unasked —
  as it does today in Auto, so the experiment is never worse than the flag off. The patterns are a list; a command
  written to avoid them (an alias, a script file, a language's own `unlink`) is reversible to the classifier. It is
  a seatbelt for an honest agent, not a guard against a hostile one — the approval modes and levels stay that.
- An MCP server that gives no annotations is judged by its tool's name alone.
- In Unattended mode an outward call waits up to five minutes for nobody, then the agent reports it.

## Rollback

Switch the flag off: classification, checkpoints and asks stop at once (it is read on every call). Failing removes
`modules/harness/risk/`, its three lines in `approval.js` (the ask in `gate`, the mission's sentence), its lines in
`turn/tool-calls.js`, the span fields in `trace.js` and `trace-otlp.js`, the tier on the Workstream row and the prompt
block; the MCP `destructive` annotation can stay.
