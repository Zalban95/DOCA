# Agents that know their tools — and keep knowing them after an update

Asked for 2026-09-26 by the owner; the resident agent's audit found the same
gap the same day (Desktop, `DOCA-audits/…-2.73.1.md` N7, and
`DOCA-audit-latest-findings-2026-09-26.md` §3).

## The question

*What would a Jarvis-level assistant do?* It always knows what it can do — and
what changed since yesterday — without anyone rewriting its instructions. The
helpers it sends out carry exactly the tools their job needs, and a new tool
reaches every helper whose job it belongs to. It may reshape itself freely, and
a few things always wait for the owner's nod. What it is, and who it works for,
are readable files a person can open, and that another harness could import.

## What is true today (v2.74.0)

| Level | Tools it is offered | What it is told about them |
|---|---|---|
| Orchestrator | `MAIN_TOOLS`, 18 names hard-coded in `organization.js` | a hand-written 8-line `DEFAULT_SYSTEM_PROMPT` naming 3 tools, and a count |
| Work chat | everything, minus the owner's switches | the same constant, and a count |
| Specialist | the `tools` list written in its JSON definition when it was made | a count |

So: a tool added in a release is invisible in every prompt (it is only in the
function list), never reaches the Orchestrator, and never reaches a specialist
unless someone edits that specialist's file. Nothing tells any agent that its
tools changed.

## The shape

### 1. Kits: tools belong to families, and agents hold families

Every tool declares its **kit** — `code` (search_files, replace_in_files, git,
project), `files` (read_file, write_file, list_dir), `shell` (shell, shell_job),
`web` (http_fetch, research_docs), `canvas`, `devices` (ask/tell_device,
doca_clients, show_media), `memory`, `organization` (work_chats, work_plan,
agent_*), `panel` (settings_*, install_propose, system_status, mcp_status) —
and one line of **when to use it**, written next to the tool, not in a prompt.

An agent is given **kits**, plus or minus single tools. A tool added to a kit in
a later release reaches every agent holding that kit, by construction. That is
the update mechanism: nothing to edit, nothing to migrate.

- **Tools are decided by agent type**, never per turn or by the Orchestrator
  handing them out: the type's definition names its kits.
- **Orchestrator:** every kit. Its freedom is close to absolute; what it should
  still hand to work chats (long jobs) is guidance in its identity, not a
  missing tool.
- **Work chat** (the Orchestrator's main subagents): every kit, the same level
  as the Orchestrator.
- **Specialist:** the kits its definition names (a Blender engineer: `files`,
  `shell`, `web`; a reporter: `panel`, `shell`), plus the mission kit it always
  has. The old `tools` lists keep working and are read as extra single tools.

### 2. The prompt says what the turn is offered — generated, never written

A `# Your tools` section is built at prompt time from the registry, for exactly
the tools this turn is offered (after kits, the owner's switches and the level's
rules), grouped by kit, one line each. Adding a tool needs no second edit
anywhere. The hand-written constant keeps only what is not a tool list.

### 3. After an update, every agent is told what changed

The panel keeps the catalogue it last showed each level. When a release adds,
removes or changes tools, the next turn of each level carries one notice:
*"Since your last turn: new — canvas (preview), search_files…; removed — …"*,
from the registry diff. Memory entries that name a tool that no longer exists
are flagged for the agent to correct.

### 4. Identity and the person as files — readable, editable, importable

Definitions become markdown with a small front matter — the format Claude Code
subagents, AGENTS.md and OpenClaw's SOUL/USER files already share, so importing
from another harness is copying a file:

```
---
name: blender-engineer
description: Builds and renders Blender scenes. Dispatch for 3D modelling and renders.
kits: [files, shell, web]
tools: [+show_media]
model: default
---
You are the Blender engineer. … (its role, its voice)
```

- `persona.md` — who the Orchestrator is and how it works (the "soul"). It
  may edit it.
- `human.md` — the person it works for, in their own voice ("I like short
  answers; I build Android apps"). Durable facts the agent learns stay in
  memory. (Named 2026-09-26. `human.md` was considered and dropped: read by the
  agent, "me" is itself. `persona`/`human` is the Letta/MemGPT convention,
  unambiguous from both sides.)
- `agents/<id>.md` — one per specialist. Shipped ones live in the repository
  (global, standard figures); ones made on this machine live in the data folder
  (this person's own). Later: promote a local one to the repository.
- JSON definitions keep loading; they are written back as markdown when edited.

### 5. Permissions per file, not a wall

The agent editing its own files is by design. What changes is which files ask
(built in phase 1):
- **free** — its own identity file, its specialists' definitions, `human.md`;
- **ask** — the control plane (panel settings, keys, accounts, devices, the
  release pointer, service units): the write waits for the person's click
  **in every approval mode**, Unattended included — never a silent write, never
  a flat refusal;
- **never** — the safety charter, which lives in code.

## Phases

**Phase 1 built in v2.75.0; phase 2 in v2.76.0; phase 3 in v2.77.0** (checkpoints: `modules/projects/checkpoints.js`); **phase 4 in v2.78.0** (`specialists/*.md` shipped, local overrides, promote) — `agents/markdown.js`
(definitions as `.md`, Claude Code subagents imported with their tools mapped
onto kits, a folder import, export), the registry saving markdown (an older
`.json` moved aside), `harness/identity.js` (`persona.md` in the Orchestrator's
prompt, `human.md` in the Orchestrator's and work chats', both in the data
folder, capped, editable in Settings → Harness → Who and by the agent). Shipped
standard agents in the repository are phase 4.


1. **Now:** kits and per-tool "when" lines; the generated `# Your tools`
   section at every level; the Orchestrator on every kit; specialists holding
   kits (old lists still honoured); the update notice; control-plane writes
   ask instead of refusing; a test that the readings travel as `user` (the
   local-model trap the audit named).
2. **Next:** markdown definitions (`agents/*.md`, `orchestrator.md`,
   `human.md`), import from a Claude Code / OpenClaw folder, export.
3. **Then: undo for agent runs.** Before a work chat or a specialist changes a
   project, a git checkpoint (a commit on a side ref, or a stash-like snapshot
   of the tree); after it, one click — or the agent itself — goes back to the
   checkpoint and tries again with a different prompt, a different model or a
   different specialist. The run's transcript stays beside the checkpoint, so
   two attempts can be compared. `modules/projects/git.js` is the base.
4. **Later:** standard agents and kits shipped from the repository; promoting
   a specialist made here to the repository; skills as a layer beside kits and
   identity.
