# Permissions — auth phase 2, in the database

**Status:** decided with Al 2026-10-04; built in steps (§6). Extends
`docs/design/auth.md` (phase 1: accounts, sessions, the route→right gate).

## 1. Why

Phase 1 answered "who may call this route". It did not answer what the agent
may do *for* that person, what a specialist may do beyond its definition, or
who allowed an exception — and three kinds of state were tracked in three
places that could disagree (a mission's outcome and its conversation's, a
path's allowance and its real target, a refusal and the advice next to it).
The decision: one model, kept in SQL, read by one function, automated so a
person sets it once.

## 2. Tables

| Table | Holds |
|---|---|
| `users`, `orgs`, `memberships`, `sessions` | Accounts (migration 3, `modules/auth/accounts-sql.js`). JSON files imported once; PostgreSQL keeps files until its async path exists. |
| `levels` | Permission levels. Built-ins viewer, member, admin, owner (the phase-1 roles, unchanged); an admin makes more. A level is **rights** (`read`, `chat`, `propose`, `host`, `devices`, `users`, `org`, `delegate`), the **setting prefixes** it may change, a **tool policy** (`allow` / `deny` patterns such as `shell:git`, `shell:*`, `read_file`), and an **approval policy** (`mode` = follow the panel, `ask` = always ask). |
| `grants` | Explicit exceptions: `subject` (a user, a specialist type, a mission, a session) gets a `permission` (a tool, `tool:verb`, a path, a setting prefix, a right) from a `granter` (a user, or an agent acting for one), with a `scope` (permanent, session, mission) and an expiry; revocable; every change audited. |
| `runs` | One row per turn, mission or job: who it runs as, its parent, state, outcome, its plan and plan progress. Written once at each end, read by everyone who shows it (§5). |

## 3. One decision: `permits(subject, permission, ctx)`

In order, first answer wins:

1. **The rules.** The charter, the control plane (files that govern the
   agent), `registry.NEVER` (tools no specialist holds). A grant cannot
   override these.
2. **The ceiling.** An agent starts at the level of the person it acts for
   (`client.user` / the conversation's person). A specialist is that,
   narrowed by its definition.
3. **Exceptions.** A grant can widen a specific user or specialist. Only an
   admin, or someone of the same level who also holds `delegate`, may make
   one — and never beyond what the granter holds. The Orchestrator or a work
   chat may grant the specialist it dispatched, within its own ceiling, for
   that mission.
4. **Approval.** Allowed is not unasked: a level with approval `ask` (every
   level without `host`, by default) has its tool calls asked whatever the
   panel's mode; an answer of "always" becomes a grant.

Paths are compared by their **real** path (symlinks resolved) against the
level's and the grants' paths.

## 4. Where people meet it

- **Settings → Users & levels** (right `users`): create a user with a one-time
  password, suspend, assign a level; create and edit levels — rights, setting
  prefixes, tools, approval — and see and revoke grants.
- **Approvals, on every device** (the panel, the page DocaMobile shows, the
  watch): Approve once, Always allow `<verb>` (a grant), Approve all waiting,
  Deny, Full auto — each offered only to someone whose level holds it.
- **The agent** is told its ceiling and its grants in its limits block, and a
  refusal says which of the four steps refused and who could change it.

## 5. State compared to plan

`runs` is the single record of what is running and how it ended; a mission's
state and its conversation's are read from the same row, so they cannot
disagree. A run carries its plan (`work_plan` / `mission_plan`) and its
progress; at each end the panel compares them automatically — a run that ended
`done` with plan steps not done, or still running past its plan, is flagged to
whoever it reports to.

## 6. Steps

1. Accounts in SQL — **2.138.0**.
2. Levels, the `delegate` right, and the Users & levels page.
3. Grants and `permits()`; agents at the person's level; `ask` levels; real paths.
4. Device approvals: Always allow / Approve all, by level.
5. `runs`: one state record; plan comparison.
6. One event sink for the three chats (front end, alongside).
