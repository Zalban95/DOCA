# CAMPAIGN — working through TODO-CAMPAIGN.md

`TODO.md` is frozen as of commit `3a9bc9e`-era and is **not to be edited again**.
`TODO-CAMPAIGN.md` is the working copy and the source of truth for this list.
Every item below carries the line number it came from, so the two can be
diffed.

Rules for this campaign, from the user:

- **Test at every point**, starting from what can actually be done and tested.
- **Ignore the clients** (`DocaMobile`, `DocaDesk`, `DocaWear`) — they are
  separate repos and not in scope.
- **Do not stop** until the plan's points are complete.
- Subagents may be used where it is not disruptive.

Status: `TODO` · `WIP` · `DONE` · `BLOCKED` (with the blocker named) ·
`NOT-OURS` (lives in another repo) · `DECISION` (needs a human answer first)

---

## Wave 1 — small, self-contained, testable now

These are the ones with a named cause in the file and a test that can pin them.
Starting here because they are provable.

| # | Item | Line | Status |
| --- | --- | --- | --- |
| W1.1 | Tool schemas serialized last, so never cached — measure then move | 175 | **CLOSED — premise false, measured** |
| W1.2 | Panel reports cache cumulatively — surface per-step + growth | 188 | **DONE** |
| W1.3 | `modules/files.js:79` ENOENT on a moved favourite → 500 | 565 | **DONE** |
| W1.4 | Status lines clear on four schedules — one rule on `setStatus()` | 543 | **DONE** |
| W1.5 | "Restart to apply" worded three ways | 550 | **DONE** |
| W1.6 | Device rotate/revoke + skill toggles report via `appAlert()` only | 570 | **DONE** |
| W1.7 | Shell scripts editable in two places (`setup-phase2.sh` asymmetry) | 556 | **DONE** |
| W1.8 | MCP add-server form has no `headers` field | 54 | **DONE** |
| W1.9 | Proposal not tied to the conversation that made it | 113 | **DONE** |

## Wave 2 — medium features, specified well enough to build

| # | Item | Line | Status |
| --- | --- | --- | --- |
| W2.1 | **H-9b** — tool results rewritten between steps (ISSUES.md) | — | **DONE** |
| W2.2 | Model fallback chain on stall, with the two deadlines | 451–472 | TODO |
| W2.3 | Shared core context the orchestrator owns for all specialists | 368 | TODO |
| W2.4 | Mission `plan` so a client can draw progress | 304 | **DONE** |
| W2.5 | Settings proposals reach `/api/v1` (not panel-only) | 108 | TODO |
| W2.6 | MCP HTTP transport: hold the event stream open | 22 | TODO |
| W2.7 | Keyword search / cross-session recall over sessions | 133 | TODO |
| W2.8 | Ledger kept: reader for "what did this week cost" | 150 | TODO |
| W2.9 | `contextWindow` discovery instead of hand-typing | 124 | TODO |
| W2.10 | `mcp.listener` gets an ack instead of fire-and-forget | 93 | TODO |
| W2.11 | `settings.propose()` takes a `sessionId` from the tool | 113 | TODO |

## Wave 3 — needs a design decision before code

| # | Item | Line | Status |
| --- | --- | --- | --- |
| W3.1 | `/api/mcp` authentication | 69 | DECISION |
| W3.2 | MCP registry over `/api/v1` (blocked on W3.1) | 30 | DECISION |
| W3.3 | `origin` as a label vs. a permission boundary | 60 | DECISION |
| W3.4 | Are `disabledTools` advisory or a boundary? | 77 | DECISION |
| W3.5 | `http_fetch` host policy (ISSUES.md H-7) | 77 | **PARTIAL** — browser guard on the two apply routes; real answer is W4.1 |
| W3.6 | VMs local-only / client-hosted VMs | 98 | DECISION |
| W3.7 | Second harness instance, shared memory? | 297 | DECISION |
| W3.8 | Search: embeddings or not | 144 | DECISION |
| W3.9 | Skill-write path and the leak (typed procedure, quarantined reader) | 183 | DECISION |
| W3.10 | Autonomous evaluator needs a test tenant | 274 | DECISION |

## Wave 4 — large features, need scoping

| # | Item | Line | Status |
| --- | --- | --- | --- |
| W4.1 | Every user authenticates; dashboard + `/api/*` behind a login | 410 | TODO |
| W4.2 | Several users, groups, rights on one server | 420 | TODO |
| W4.3 | Orchestrator drives the work, not does it (+ dispatch rule) | 339 | TODO |
| W4.4 | No embedded VNC console | 14 | TODO |
| W4.5 | No VM creation wizard | 18 | TODO |
| W4.6 | One conversation, one turn — jobs as first-class | 289 | TODO |
| W4.7 | Every shipped procedure ends by reading back what it wrote | 266 | TODO |

## Wave 5 — environment / process, not code in this repo

| # | Item | Line | Status |
| --- | --- | --- | --- |
| W5.1 | `D:\doca\` holds an old `openclaw-dashboard` 2.1.0 — archive it | 536 | NOT-HERE (Windows box) |
| W5.2 | Tags: annotated vs lightweight — pick one and keep to it | 524 | PROCESS |
| W5.3 | Clients do not version themselves | 529 | NOT-OURS (clients) |
| W5.4 | DocaDesk shadowed tool name (`ProxiedName` dedupe) | 40 | NOT-OURS (DocaDesk) |

## Wave 6 — closing out

| # | Item | Line | Status |
| --- | --- | --- | --- |
| W6.1 | `/api/update-check` private-repo premise | 492 | DONE (verified public) |
| W6.2 | `firstTokenTimeoutMs` × tool count — note only | 203 | NOTE |
| W6.3 | Sessions share a cached prefix — keep it that way | 208 | NOTE |
| W6.4 | Auth comes before groups; migration story | 410 | NOTE |

---

## Progress log

Appended as waves land. Each entry names the test that pins it.

### Commit attribution is partly wrong — read this before trusting `git log`

The campaign driver used `git add -A`, which swept a subagent's uncommitted work
into its own commits. Nothing is missing and every line is tested; what is wrong
is that two commit messages do not describe their contents:

| Commit | Message says | Actually also contains |
| --- | --- | --- |
| `cd7c1f9` | W1.9, proposals carry a sessionId | **all of W1.4 and W1.5**, and the `paths.js` half of W1.7 |
| `1ee1f0d` | H-7, a browser guard on the apply routes | the `config.js` half of W1.7, and `test/status-lines.test.js` |

`git log --oneline` therefore under-reports this campaign by three items. The
correct fix is to split the commits, which is safe while the branch is unpushed
but was not done unilaterally — history rewriting is the user's call. Recorded
here so a later reader is not misled either way.

**Lesson for the rest of the campaign: never `git add -A` while a subagent is
working in the same tree.** Stage named paths, or wait for the agent to hand
back.

**W1.4 — one schedule on `setStatus()`** (in `cd7c1f9`). Rule is "success fades,
errors stay": `'err'` persists, everything else clears at 3000 ms, per-call
`opts.clear` overrides (a number, or `0` for a standing state). Pending timers
are tracked per element in a `WeakMap` and cancelled by the next call — which
also fixed a real bug where a ✓'s timer could erase the ✗ that replaced it. Five
divergent call sites now use the shared default. New `test/status-lines.test.js`
loads the real `public/js/utils.js` into a `vm` with a fake clock, and a second
test fails if any other file goes back to timing its own status line.

**W1.5 — two restart phrases, one meaning each** (in `cd7c1f9`, finished in
`d0…`). "restart OpenClaw" means the external stack; "Restart DOCA" means this
process. Both phrases now appear consistently with comments naming the
distinction and warning against collapsing them. The two remaining instances in
`modules/update.js` — missed in the first pass — were fixed in the follow-up,
along with two standing states that were fading at 3 s (`logs.js` streaming,
`harness.js` composer).

**W1.7 — the Config tab lists all four scripts** (split across `cd7c1f9` and
`1ee1f0d`). Chose "list all of them": dropping scripts would delete the only
editor for the configured `SNAPSHOT_SCRIPT`/`RESTORE_SCRIPT`, which need not
live in `SETUP_DIR`. `SCRIPT_CONFIG` in `modules/paths.js` is now the single
source and `CONFIG_REGISTRY` is generated from it, so the two cannot drift
structurally. Pinned in `test/paths.test.js`.

**Follow-up pass** (`d0…`). `modules/update.js` still said "Restart the server"
for the panel meaning; `logs.js` and `harness.js` faded standing states. All
three fixed. These were loose ends caused by the non-atomic commits above — the
subagent flagged them rather than fixing them, which was correct of it.

**W1.3 — files ENOENT → 404** (`e0d9c45`). `fsStatus()` maps ENOENT/ENOTDIR to
404 and EACCES/EPERM to 403, leaving 500 for genuine faults; errno travels in
the body. New `test/files.test.js` — 5 tests, the first for these routes.

**W2.1 — H-9b, tool results are stable** (`56e4142`). `clipToolContent()` is now
a pure function of the row; the backward character-budget walk is gone. Per-step
on the large-output workload: 53.4 → 66.9 → 74.4 → 80.5% (was 52/55/57/60), with
cached-delta tracking the previous step's whole prompt within ~1%, i.e. the cache
now takes everything that existed before the current step. Pinned by a new test
in `test/harness.test.js` that sends a result, appends two more, and asserts the
first is byte-identical.

**W1.6 — failures report inline** (`904ed69`). Device rotate/revoke/forget and
skill toggle/remove used `appAlert()` — a modal to say one card's button did not
work, dismissing which was required before retrying the thing that failed. The
devices grid gets a status line per card; the skills panel one outside its grid,
because a toggle re-renders the grid and an in-card status would be wiped before
it was read. Success keeps no message: the re-render is the report.

**W1.8 — the add-server form can set headers** (`cc0c56e`). `normalize()`
accepted them and `client.js` sent them, but only a client could ever set one, so
a server the user added by hand could not be given an `Authorization` header.
One textarea; parsed client-side into the object the registry wants; populated
masked on edit, which is already safe because `unmaskValues()` reads a returned
mask as "unchanged".

**W1.1 — CLOSED, premise false** (no commit; nothing to change). The entry
asserted the schemas "can never be a prefix" because they are serialized after
`messages`. Measured: the cache gap per step is ~300–333 tokens, i.e. the
readings block, against ~3,603 tokens of schema JSON — so the schemas are
*already* inside the cached prefix. DeepSeek builds `[tools][system][messages]`
and does not follow the body's key order. Moving them would have been a no-op.

The reasoning is worth keeping because the trap is subtle: the 1,152-token
ceiling in H-9 matched a body offset *exactly*, which is real evidence — and it
still did not generalise. A byte offset matching a cache boundary once is not a
rule about how caches work. The entry's own "measure before changing it" is what
stopped a pointless edit, which is the argument for writing that instruction
into a TODO rather than leaving it implied.
