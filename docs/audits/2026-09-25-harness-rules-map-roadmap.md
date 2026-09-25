# Audit: the harness's coding rules, HonTabs, a structure map, and the next three features

**Date:** 2026-09-25. **Version audited:** 2.51.0 (`main`).
**Scope:** an audit, not an implementation. Nothing in the harness was changed by
it except six stale file references in `AGENTS.md`, which the 2.51.0 split caused.
**Read against:** `modules/harness/providers.js` (the charter), `AGENTS.md`,
`TODO.md`, the untracked `audit.md` (the resident agent's self-audit of
2026-09-20), `Zalban95/HonTabs@origin/main` (16 commits ahead of the local copy,
read without pulling), and `Zalban95/StatENS` (read through the GitHub API).

Every item ends in a **decision to settle**. Proposed priorities are in §6.

---

## 0. Found on the way — act on these first

**The panel is reachable from the LAN with no login.** `server.js:400` and
`server.js:403` call `server.listen(PORT, '0.0.0.0')` — there is no setting for
the address. `ss -ltn` on `al-office-desk` shows `0.0.0.0:4242`, so anything on
the Wi-Fi (`192.168.1.0/24`) reaches `/api/*`, which has no authentication and
includes routes that run shell commands as `al`. `TODO.md` already says *"Until
it exists the panel should bind to localhost and the tailnet interface only, not
`0.0.0.0`"*; that part was never done. Fix: a `BIND` setting (env + prefs),
default `127.0.0.1` plus the Tailscale address when there is one. Small, and
independent of the auth design below.

**`AGENTS.md` pointed at code that 2.51.0 moved** (`agent.js::systemPrompt`,
`SHAPE` in `agent.js`, `agent.js::pairedRows`, `agent.js::toApiMessages`, two in
`public/js/harness.js`). Fixed with this audit. `ISSUES.md` line references are
records of the code as it was when each issue was filed and are left alone.

**`WORKSPACE_DIR` still defaults to `~/.openclaw/workspace`** (`modules/paths.js:25`,
`:62`) — the agent's default working directory is inside another product's
folder. Belongs to the identifier rename in `TODO.md`.

**An update stashes untracked files.** `update.js` runs
`git stash push --include-untracked` before pulling, so an uncommitted file such
as `audit.md` disappears from the tree on the next update (it is recoverable
from the stash, and the log says so). Worth knowing before rollback is designed
on the same code path.

---

## 1. Coding rules: what the agent is told, what the repo holds itself to

Three rule sets exist and nothing connects them:

- **The charter** (`SAFETY_CHARTER`, `providers.js:60`) — 15 rules the agent
  cannot edit. Written for *operating a machine*.
- **The repo's own practice** (`AGENTS.md`, `test/`, the version and OpenAPI
  discipline, `test/structure.test.js`) — how DOCA itself is developed.
- **HonTabs' rules for coding agents** — plan, contracts, minimal context, file
  policy, verification, human-approved merge.

| Area | Charter (agent) | DOCA repo | HonTabs | Consistent? |
|---|---|---|---|---|
| Look before touching | Rule 1 | — | Minimal context: goal, tree, spec, contracts, target files | Yes |
| Size of change | Rule 2: one change at a time | One commit per idea | One step, one set of files | Yes |
| Project conventions | Rule 3: "follow what is already there" | `AGENTS.md` | Plan + contracts in `.orchestrator/` | **No: the agent is never shown them.** It does not read a project's `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` or `CONTRIBUTING.md`. Claude Code, Codex and Cursor all do. |
| What "the project" is | — | — | `.orchestrator/plan.yaml`, immutable origin snapshot | **No concept of a project.** The workspace is a directory. |
| Plans | `work_plan`: draft, propose, the user approves | TODO decisions | Amendments, human accept/reject; anchored steps | Yes, same principle. HonTabs adds drift from origin and anchoring. |
| Git | Rule 5 forbids rewriting history, nothing else | Branch, tag, push by hand | Git bridge; commit message from the staged diff; human approves merge | **No.** No branch rule, no "never commit to the default branch", no "never push without asking", no diff before commit, no git tool (only `shell`). |
| Done means checked | Rule 10: report honestly | `npm test`, 416 tests, guards | `checks.ts` per step (whole-project, coarse, per HonTabs' own evaluation §6) | **No.** Nothing tells the agent to run the project's tests before saying it is done. |
| Where it may write | Rule 8: stay in the workspace (a request) | — | `safeWriteFile` sandboxed to the project | **No.** Stated but not enforced: `fmSafe` allows every root in `FM_ALLOWED_ROOTS`, including HOME (`ISSUES.md` H-19). |
| File granularity | — | One idea per file, 400-line ceiling, guarded | "Concise files, ideally one exported function each" | **Conflict.** See §2. |
| Failure shape | Rule 12: name the limit | — | `{step_id, file, contract_ref, assertion, actual, expected}` | Recorded in `TODO.md` (audit distillation) as a gap. |
| Secrets | Rule 7 | — | API keys via env/file, warns on inline | Yes, apart from H-19. |

### Proposed: a "Working on a repository" block in the charter

Enforced in code where it can be (a git tool, a write sandbox), and stated in the
charter for the rest. The same text goes into DOCA's own `AGENTS.md`, so the repo
holds itself to the rules it gives its agent.

1. **The repository's rules come first.** Before the first change, read its
   `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `CONTRIBUTING.md`. Where they
   conflict with this block they win; they never override safety rules 5–9.
2. **Know the state before you change it.** Check the current branch and
   `git status`. Uncommitted work you did not make is someone's; do not
   overwrite, stash or discard it.
3. **Never work on the default branch unless asked.** One branch per task,
   named for the task.
4. **Commit when asked or when the approved plan says so**, one logical change
   per commit, and the message says why. Never push, force-push, tag, merge or
   open a pull request without asking.
5. **Done means checked.** Run the project's own tests, lint and build for what
   you changed, and report the result as printed. If the project has none, say so.
6. **Show the diff before asking to commit**, and say what you did not verify.
7. **Leave the tree as you found it apart from the change:** no stray files or
   logs, and no lockfile churn you did not intend (`audit.md` finding #10).
8. **Stay inside the project root** while working on a project. This is enforced
   by the file tools, not only asked for.

Loading the project's rule files is the cheapest item in this whole audit, and it
matters most: it is what makes rule 3 of the charter work at all.

**Decide:** adopt the block, with any changes to the wording; and whether rules
2–4 get a guarded `git` tool now or later (§3).

---

## 2. HonTabs and DOCA: graphs and orchestration

**What HonTabs does, mechanically and with no LLM:**
- A plan whose steps consume and produce **contracts**: typed signatures checked
  against what the code actually exports.
- A DAG built from the plan: which steps can run now, dead ends (a contract
  nothing produces), cycles (added in its evaluation branch), and blast radius
  (everything downstream of a contract).
- All-or-nothing contract locks, minimal context per agent, and a human who
  approves every merge.

**What DOCA does:** three levels (the chat, the orchestrator, specialists).
Authority runs down and reports run up, with plans that are proposed and then
approved. There is no dependency graph between missions. `TODO.md` (audit
distillation, 2026-09-21) says DOCA "should not grow one to satisfy a checklist".

**Findings:**

- **The shared principle holds in both repos:** the agent proposes, a person
  decides (`settings_propose`, `install_propose` and `work_plan` in DOCA;
  amendments and merge approval in HonTabs). Keep it as the rule every new
  feature follows.
- **The two graphs are different objects, and only one fits DOCA.** HonTabs'
  graph is *declared*: the plan says which contracts a step will produce.
  A structure map (§3) is *derived*: it reads which files import which. The
  2026-09-21 decision against a declared graph for missions still holds. What
  should move across is HonTabs' **graph semantics**: cycles, dead ends and
  blast radius mean exactly the same thing on an import graph, and they are
  exactly what someone changing code needs to see. DOCA itself hides import
  cycles behind lazy `require()`s (`turn/prompt.js`, `modules/harness/memory.js`),
  and a map would show them.
- **The file-granularity conflict has a rule behind it.** HonTabs can ask for
  one exported function per file because every cross-file dependency is a
  declared contract that is checked mechanically, and each implementer sees
  only its own file and the contracts it touches. DOCA's front end could not,
  because its dependencies are implicit globals. So: **files can be as fine as
  the dependencies between them are explicit and checked.** After the
  ES-module stage in `TODO.md`, finer DOCA files become safe; before it, one
  idea per file is the limit. The same rule decides what DOCA's agent should
  do in someone else's repo: follow the repo (§1, rule 1), and fall back to
  one idea per file.
- **Integrate, don't merge.** HonTabs already has an `external` provider type
  (it POSTs an `AgentTask` and expects an `AgentResult`), and DOCA has a
  harness catalog. DOCA can serve as a HonTabs implementer slot, and HonTabs
  can appear in DOCA's catalog as a project runner. That keeps the rigorous
  orchestration where it was built and makes DOCA the engine that reaches the
  machine and the devices, which is the "engine and harness of workflows"
  direction.
- **HonTabs' own evaluation is worth copying as a method.** It found that the
  headline feature, contract reconciliation, rejected correct code, and that
  the mechanical core had no tests. DOCA has 416 tests, and HonTabs had none
  until that branch. Also: the local HonTabs copy is 16 commits behind
  `origin/main`, and the fixes are merged there.

**Decide:** whether the integration (DOCA as a HonTabs implementer, HonTabs in
DOCA's catalog) goes into the TODO, and whether the map reuses HonTabs'
`GraphSnapshot` schema so the two draw from one shape.

---

## 3. The structure map: feasibility

**Asked for:** a page that pops up while coding with the DOCA harness and shows
the program's structure. It must be able to use every tool on the machine and on
the clients, work on projects, use git the way other harnesses do, and send a
cut-out of the map to a device such as the watch. Versatile, and following
established rules for managing a repo.

**Already there:**
| Need | Exists | Where |
|---|---|---|
| A window that opens over the conversation | Yes | the plan/document overlay, `agentDocOpen` in `public/js/agent-ui/media.js` |
| SVG to a PNG sized to a device's screen | Yes | `modules/api-v1/render.js` (resvg-wasm) |
| Sending a picture to a device | Yes | `tell_device` / `show_image` / `show_media` |
| Tools on the machine and on clients | Yes | `shell`, file tools, MCP including client-hosted servers (`placeBlock`) |
| Live events to the page | Yes | SSE, harness events (`agent.events`) |
| A project | **No** | §1 |
| Git, with rules | **No** | only through `shell` |
| A code graph | **No** | — |

**Shape of it:**
1. **Extractor, mechanical, per language.** JS/CJS/ESM first, with DOCA itself
   as the first subject: `require`/`import`/`export`, including lazy requires
   (marked as such). Python via `ast` in a subprocess, Go via `go list -json`.
   tree-sitter as the general answer later, the same end-state HonTabs defers
   to. The output is nodes (files, grouped by folder), edges (imports), plus
   cycles, dead ends and blast radius.
2. **Three views.** An overview of folders as clusters; a focus view of one
   file and its neighbours; and a **change overlay** showing the files this
   branch touches (`git diff --name-only`) and the ones the agent is writing
   right now, from `write_file` events. The overlay is the "while coding" part.
3. **Opening it.** A `show_map` tool the agent calls, a button the user
   presses, and live updates over SSE.
4. **Cutting it out for a device.** The server renders the same SVG the page
   draws, clipped to the focus subgraph, through `render.js` at the target's
   screen size, then `tell_device`. A 450 px watch holds about 15 nodes, so a
   device gets the focus view and never the whole map.
5. **Git as a tool, not a shell string.** `status`, `diff`, `branch` and
   `commit` enforce rules 2–4 in code. `push` asks through `ask_device` first.
6. **Layout on the server**, because the watch needs a picture and the SVG must
   be built in Node: `dagre` or `elkjs` (both pure JS). Graphviz is **not
   installed** on this host, and requiring it would add a system dependency
   for every customer.

**Decide:** which languages come first (proposed: JS/TS, then Python); `elkjs`
or `dagre`; whether a map is saved per project; and whether §1's project concept
and git tool come before the map (proposed: yes, since the change overlay needs
both).

---

## 4. Roll back to an earlier version from a dropdown

**Today:** updating runs `git pull` on the current branch (`update.js`), with
local changes stashed first. Releases are tagged `vX.Y.Z` (the three newest are
`v2.51.0`, `v2.50.3` and `v2.50.2`). `LOCAL_VERSION` is read once at boot.

**Asked for:** a dropdown of versions showing each one's release date and when
it was installed here, and choosing one rolls back to it.

**Two ways to do it:**
- **(a) `git checkout vX.Y.Z` in place.** Small, but it leaves a detached HEAD,
  which breaks the branch-based `git pull` update. `node_modules` can also
  belong to the wrong version, and a broken checkout is the same tree the
  panel is running from.
- **(b) Release folders with a `current` link** (proposed). Each version is a
  git worktree `releases/vX.Y.Z` with its own `node_modules`, and the service
  runs `current/run.sh`. Switching means moving the link and restarting, so a
  rollback is immediate and the old version is never modified. Keep the last
  N versions.

**Needed with it, whichever way:**
- **An install log**, a file recording `{version, at, from}` on every switch.
  That's where "installed here on …" comes from. The release date is the
  tag's own date.
- **Data compatibility.** The stores under `DOCA_DATA_DIR` change over time,
  and there is no data format version today. Rolling back past a format
  change must warn or refuse. Add a format stamp now, while it is cheap.
- **Automatic revert.** If the dashboard breaks, the dropdown may be exactly
  the thing that does not load. So: if a new version fails its health check
  within about 60 s of switching, switch back on its own, plus
  `run.sh rollback [version]` on the command line. This covers the failure the
  feature is meant for.

**Decide:** (a) or (b); how many versions to keep; whether auto-revert is on by
default (proposed: yes).

---

## 5. Alternative UIs, as a choice rather than a replacement

**Today:**
- Colour themes (`themes.js`) and tokens (`public/css/variables.css`, 52 lines).
- Mobile breakpoints (`responsive.css`, 282 lines).
- About 3500 lines of CSS, much of it in `components.css` (1171 lines).
- Markup for every screen in one `index.html`, with about 350 inline handlers.

**There are two levels, and they cost very different amounts:**
- **Skins: CSS only.** Tokens plus component styles, so a skin changes how
  everything looks, including its own mobile layout. Doable once
  `components.css` is split and every colour, radius, spacing and font goes
  through tokens. Each skin is one folder of CSS.
- **Layouts: different structure,** such as a sidebar versus tabs, or dense
  versus touch-first. These need the front end's logic separated from its
  markup: the ES-module stage and `data-action` delegation in `TODO.md`.
  Before that, every alternative layout would copy the logic, and the copies
  would drift apart, which is the problem the modularity work exists to end.

The choice belongs to each person, the same StatENS rule that says preferences
belong to the person and categories to the organisation. So a per-person skin
setting depends on auth (§6), and until then a skin is per browser.

**Decide:** skins first and layouts after stage 3 (proposed), and which style
the first alternative skin should be.

---

## 6. Authentication

**Wanted, as `TODO.md` already specifies it:**
- A login in front of the dashboard and all of `/api/*`.
- Browser sessions as an `HttpOnly` `SameSite=Strict` cookie, with device tokens
  unchanged.
- Users in groups with rights.
- Memory and transcripts separated per user and group, **enforced in the store
  paths**, not asked for in the prompt.

**StatENS already has this model.** It's written in Go:
- Users, plus memberships with a role (`traveller` / `approver` / `admin` /
  `owner`) and a status (`pending` until an admin approves).
- Opaque session tokens in an `HttpOnly` cookie, stored only as a SHA-256 hash.
  StatENS chose this over JWTs because suspending someone must sign them out at
  once.
- Argon2id with its parameters stored in the hash, TOTP, admin-created accounts
  with a one-time password, one level of team leaders, and an append-only audit
  log.

| Option | What it is | For | Against |
|---|---|---|---|
| **A. Tailscale identity** | Serve the panel only through `tailscale serve`, which adds the `Tailscale-User-Login` header, and trust that header only on that path | Zero code, available today, and you already use Tailscale | Tailnet users only, no rights model, no use to a customer without Tailscale |
| **B. A gateway in front** | Authelia (Apache-2.0), oauth2-proxy or Authentik, doing forward-auth | Guards every app, in any language, including future projects | DOCA still needs identity inside the app for per-user memory, so the gateway passes a header and DOCA must trust it only from the gateway. One more service to run |
| **C. A library** | e.g. better-auth (MIT, TypeScript, with organisation, role and 2FA plugins) | Fast and maintained by others | DOCA is CommonJS and better-auth is ESM-first. A dependency at the most sensitive point. Check the licence and the module format when deciding |
| **D. Port StatENS's model** | The same tables and rules, in Node: `node:crypto` scrypt or `argon2`, hashed opaque sessions, memberships, TOTP, audit log | A design you already chose and run. No framework. The TODO already points to it | Roughly a few hundred lines to own and have security-reviewed |
| **E. Your own open-source auth service** | A reusable identity server | One login across all your projects | That means building Authelia or Authentik again. Worth it only in a smaller form: **a documented schema and rules** shared by StatENS and DOCA, implemented in each project's own language |
| VM or Docker | Run DOCA inside an isolated box | Contains damage | That's isolation, not authentication: the box still needs a login. And DOCA's job is to manage the host (shell, Docker, VMs), so boxing it removes what it's for. Useful for *tools* the agent runs, not for the panel |

**Proposed:**
- **Now:** option A together with the listen-address fix from §0. That's a few
  hours and closes the real exposure.
- **For the product:** D, with TOTP. Also the security-sensitive part of the
  licence decision, so have it reviewed before a customer relies on it.
- **Later:** E in its smaller form, the StatENS/DOCA schema written up as a
  small spec that every future project follows. B only if a customer needs
  single sign-on with their own identity provider.

**Decide:** A now; D or C for the product; whether E in its smaller form is
worth starting.

---

## 7. Proposed priorities

| When | What | Why this order |
|---|---|---|
| **P0 (now)** | §0 listen-address fix + option A | Live exposure on this machine |
| **P0** | §1 rule block, plus loading the project's rule files | Cheap. Everything the harness does in a repo depends on it |
| **P1 (Monday's release)** | Rename + licence (already in the TODO) | Already dated |
| **P1** | §4 rollback (release folders, install log, auto-revert, data format stamp) | A safety net before the larger front-end work lands |
| **P1** | §6 option D (StatENS model) | Required for customers, per-person skins, and groups |
| **P2** | Project concept + guarded git tool | Needed by the map's change overlay |
| **P2** | §3 map v1 (JS/TS, DOCA as the subject, popup, cut-out to the watch) | Builds on P2 above |
| **P3** | ES-module stage 3 → skins → layouts (§5) | Layouts depend on stage 3 |
| **P3** | HonTabs integration (§2) | After the project concept exists on both sides |
| **Ongoing** | The remaining splits (`runTurn`, `components.css`, `chat.js`, `tools.js`, `files.js`) | Guarded now. Done alongside the rest |
