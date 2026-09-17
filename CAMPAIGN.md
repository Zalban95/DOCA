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
| W1.1 | Tool schemas serialized last, so never cached — measure then move | 175 | TODO |
| W1.2 | Panel reports cache cumulatively — surface per-step + growth | 188 | TODO |
| W1.3 | `modules/files.js:79` ENOENT on a moved favourite → 500 | 565 | TODO |
| W1.4 | Status lines clear on four schedules — one rule on `setStatus()` | 543 | TODO |
| W1.5 | "Restart to apply" worded three ways | 550 | TODO |
| W1.6 | Device rotate/revoke + skill toggles report via `appAlert()` only | 570 | TODO |
| W1.7 | Shell scripts editable in two places (`setup-phase2.sh` asymmetry) | 556 | TODO |
| W1.8 | MCP add-server form has no `headers` field | 54 | TODO |
| W1.9 | Proposal not tied to the conversation that made it | 113 | TODO |

## Wave 2 — medium features, specified well enough to build

| # | Item | Line | Status |
| --- | --- | --- | --- |
| W2.1 | **H-9b** — tool results rewritten between steps (ISSUES.md) | — | TODO |
| W2.2 | Model fallback chain on stall, with the two deadlines | 451–472 | TODO |
| W2.3 | Shared core context the orchestrator owns for all specialists | 368 | TODO |
| W2.4 | Mission `plan` so a client can draw progress | 304 | TODO |
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
| W3.5 | `http_fetch` host policy (ISSUES.md H-7) | 77 | DECISION |
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
