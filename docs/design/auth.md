# Authentication — design

**Status:** decided 2026-09-25 (§8); phase 1 in progress.
**Settled already** (`TODO.md`): port StatENS's model, shaped for tenants from
the first line; device tokens keep working; on migration everything that exists
becomes the first user's; auth comes before groups.

---

## 1. What stands in front of DOCA today

| Surface | Today | Consequence |
|---|---|---|
| Dashboard and every legacy `/api/*` route | nothing | Anyone who can reach the port can run shell, docker, VM, file and settings routes as `al` |
| WebSocket terminals and harness socket (`terminal.js`) | nothing | A shell for anyone who reaches the port |
| `/api/v1` | bearer device token, SHA-256 at rest, scopes, rotation, revoke (`api-v1/devices.js`) | Sound, and kept as it is |
| Pairing a device | started from the dashboard (`devices-panel.js`) | **Anyone who reaches the dashboard can mint a device token, admin scope included** |
| Network | `modules/listen.js` (2.52.0): loopback + tailnet only | The only guard, and it is a network boundary, not an identity |

So the design has one job before any other: **nothing under `/api/*`, no socket,
and no pairing without a signed-in person, whose rights decide what it may do.**

## 2. The model — StatENS's, mapped

StatENS (`Zalban95/StatENS`, `server/internal/{auth,store}`, `ARCHITECTURE.md`)
is the reference. What carries over unchanged, because it is right regardless of
the product:

- **Local accounts:** email + password, **Argon2id** with the parameters stored
  in the hash (StatENS: t=3, m=64 MiB, p=4 — the same numbers here, so a user
  table can move between the two), **TOTP** as the second factor, no dependency
  on an outside identity provider — a self-hosted install may have no internet.
- **Sessions are opaque tokens in an `HttpOnly` cookie, stored only as their
  SHA-256.** Not JWTs: suspending someone must sign them out *now*, and a JWT
  needs a revocation list to do that — "a session table wearing a hat".
- **Memberships** join a user to an organisation with a **role** and a
  **status** (`pending` until an admin approves; a state, not a boolean, so the
  approval survives in history).
- **Accounts an admin creates get a one-time password** from an alphabet that
  cannot be misread (no O/0, l/I/1), shown once, replaced at first sign-in.
- **An append-only audit log** of who acted, on whose behalf, and what —
  never deleted with what it describes.

What DOCA adds, because it is not an expense tracker:

- **The agent acts for a person.** Every turn, mission and proposal records the
  user who started it; the audit log reads "Alice (via the harness): applied
  proposal P-12", never an anonymous "agent".
- **Some rights are the host itself.** Shell, terminal, Docker, VMs, MCP servers
  that spawn processes, and writing files are equivalent to being the unix user
  DOCA runs as. They are one right (`host`), granted to owner and admin by
  default and to nobody by accident.
- **Devices belong to a user.** A device's effective rights are its scopes
  *intersected* with its user's rights; suspending the user silences their
  devices.

### Tables

JSON documents under `DATA_DIR/auth/` through `store.js` (atomic writes, 0600),
behind a small interface so a database can replace them for the hosted case
without touching the callers. One file per concern:

```
auth/users.json         { id, email, name, passwordHash, totpSecret?, recoveryHashes[],
                          mustChangePassword, createdAt, suspendedAt? }
auth/orgs.json          { id, name, createdAt }                  — one row on a personal install
auth/memberships.json   { orgId, userId, role, status, approvedBy?, approvedAt?, createdAt }
auth/sessions.json      { tokenHash, userId, orgId, createdAt, expiresAt, lastSeenAt,
                          userAgent, ip, stepUpAt? }
auth/audit.jsonl        { at, orgId, actorId, subjectId, via?, action, detail, ip }   — append only
```

Devices keep their own file and gain `userId` and `orgId`.

### Roles and rights

StatENS's roles are about expenses; DOCA's (named in `TODO.md`) are about a
machine. Rights are checked, roles are only bundles of them:

| Right | viewer | member | admin | owner |
|---|:-:|:-:|:-:|:-:|
| `read` — status, logs, transcripts they may see | ✓ | ✓ | ✓ | ✓ |
| `chat` — talk to the harness, start their own conversations | | ✓ | ✓ | ✓ |
| `propose` — apply settings/install proposals | | | ✓ | ✓ |
| `host` — shell, terminal, Docker, VMs, files, MCP servers | | | ✓ | ✓ |
| `devices` — pair and revoke devices | own | own | all | all |
| `users` — create, suspend, change roles | | | ✓ (not owners) | ✓ |
| `org` — backups, versions, rename, delete | | | | ✓ |

A member may pair their own devices, and those devices can never exceed
`chat`. Backups and version switches are owner-only because a restore replaces
everyone's data and a switch changes everyone's code.

## 3. How a request is decided

```
request ──► listen guard (loopback/tailnet) ──► is it public? ──► yes: serve
                                                 │ no
                                                 ▼
             bearer device token? ──► /api/v1 as today, rights ∩ user's rights
                                                 │ no
                                                 ▼
             session cookie valid, user active, membership approved?
                                                 │ no ──► 401 (API) / login page (HTML)
                                                 ▼
             right for this route? ──► no ──► 403, audit "denied"
                                                 ▼
             state-changing and not same-origin? ──► 403 (CSRF)
                                                 ▼
             handler, with req.user / req.org / req.rights
```

- **One map from route to right**, `modules/auth/rights.js`, checked by one
  middleware. A route not in the map is **denied**, not allowed — so a route
  added later without a thought about rights fails closed, and a test lists
  every route and fails when one is unmapped.
- **Public:** the login page and its assets, `/api/auth/login`,
  `/api/auth/setup` (only while there are no users), `/api/v1/devices/pair/complete`
  (it carries its own one-time code), `/api/v1/openapi.json`.
- **WebSocket upgrades** read the same cookie and need `host` (terminal) or
  `chat` (harness socket) before `handleUpgrade`.
- **CSRF:** the cookie is `SameSite=Strict`, and every state-changing request
  must also carry an `Origin` equal to the panel's own, or the `X-Doca: 1`
  header `apiFetch` adds. Belt and braces, because `SameSite` alone does not
  cover a same-site attacker on the tailnet.
- **Step-up:** `host`, `users` and `org` actions need the password (and TOTP if
  enrolled) within the last 12 hours of the session — so a borrowed unlocked
  laptop does not get a root shell for thirty days.

### Sessions

- Cookie `doca_session`: 32 random bytes, base64url; `HttpOnly; Secure;
  SameSite=Strict; Path=/`. `Secure` is dropped only on the plain-HTTP fallback,
  and the login page says the connection is not encrypted when it is.
- **30 days**, extended on use up to that absolute limit; signing out, a
  password change, suspension and "sign out everywhere" delete the rows.
- **Rate limit:** failures per account and per address, with a growing delay
  after 5 and a 15-minute lock after 10; the lock is logged, not silent.

### A paired app that shows the panel

Added 2026-09-25, found on the live install: DocaMobile's WebView loads the
dashboard with `Authorization: Bearer <device token>` on the page load, and
sends nothing after it. That page load opens a session for the device's person
(`credentials.fromDevice`), with `deviceId` and a `cap` from the device's scopes
(`capOf`: `*` → the person's role; otherwise read, chat if `harness:*`, devices
if `devices:admin`). A capped action answers `step_up_required`, so the panel
asks for the password in place; the password lifts the cap. The session ends
with the device. Only a page load is turned into a session — an API call with a
bearer token is `/api/v1`'s business — and a browser cannot send that header on
a cross-site navigation.

## 4. The first user, and existing installs

- **No users yet ⇒ setup mode.** Every route but setup answers "set up an owner
  first". Setup needs a **one-time setup code printed in the server log** at
  boot (as Jupyter does), so another device on the tailnet cannot race the owner
  to the form. `run.sh` prints it too (`./run.sh setup-code`).
- **Migration** creates the one organisation and makes everything that exists
  its own: conversations, memory, missions, devices (`userId` = the owner),
  backups. Upgrading a personal install changes nothing visible except the
  login.
- **Recovery:** `./run.sh reset-password <email>` on the host issues a one-time
  password. Having a shell on the host already means having everything, so this
  opens nothing new.

## 5. Tailscale identity — an optional shortcut

`tailscale serve` proxies to `127.0.0.1` and adds `Tailscale-User-Login`. With
`auth.tailscale: true` and `DOCA_LISTEN=local`, a request that arrives **from
loopback** with that header is the user with that email, no password. Only from
loopback, because a tailnet peer that connects directly could set the header
itself. Off by default; a convenience for a personal tailnet, not the product's
login.

## 6. The harness and the rest of the panel

- `agent.turn()` receives `{ user, org }`; `clientBlock()` says who is asking;
  tool calls that change something audit as `actor = user, via = harness`.
- `settings_propose` / `install_propose` apply only with `propose`; a mission's
  proposals belong to the user who dispatched it (closes `ISSUES.md` H-7: the
  agent cannot apply its own proposal over HTTP because it has no session).
- Missions and scheduled work run as the user who started them; a suspended
  user's missions stop.
- **Memory stays shared in phase 1** (`TODO.md`: auth before groups). Per-user
  and per-group memory, enforced in store paths, is phase 3.

## 7. Phases

| Phase | What | Leaves |
|---|---|---|
| **1** | Users, orgs (one), memberships, sessions, login page, setup mode + setup code, migration, route→right map (fail closed) incl. WebSockets, CSRF check, step-up, rate limit, audit log, pairing bound to a user, `./run.sh reset-password`, tests signing in through a helper | Everything behind a login; nothing else changes |
| **2** | Users page (create with one-time password, suspend, roles, pending approvals), sessions list + revoke, TOTP enrolment + recovery codes, per-person preferences (theme, later skins) | Several people on one install |
| **3** | Groups; conversations, memory and missions scoped to a user or a group in the store paths; the agent unable to read another group's | Shared machine, separate work |
| **4** | Hosted: many organisations, self-registration with approval, a machine (container/VM) per tenant, metering, billing | DOCA as a service |

## 8. Decisions — settled 2026-09-25

1. **Argon2id via `hash-wasm`** — the more maintainable option: WebAssembly, no
   native build to break on a Node upgrade, the same algorithm and parameters as
   StatENS. It is updated with the other dependencies (see the dependency toggle
   in `TODO.md`).
2. **JSON now, on one condition: converting to a database later must not
   multiply the work.** So every read and write of auth state goes through one
   module, `modules/auth/store.js`, whose functions are the queries
   (`userByEmail`, `createSession`, `sessionByHash`, `membershipsOf`, `audit`…),
   never "load the file". Nothing else knows there are files. Moving to a
   database is rewriting that one module against the same function list, and a
   contract test (`test/auth-store.test.js`) runs against whichever
   implementation is configured, so the second one is proven by the same tests
   as the first.
3. Roles owner / admin / member / viewer, as in §2. 4. Step-up after 12 hours.
5. Tailscale identity opt-in. 6. Pairing closed by phase 1. 7. A shared spec
   with StatENS after phase 1. — all as proposed.

### Original options, for the record


1. **Argon2id via `hash-wasm`** (MIT, WebAssembly, no native build; same
   algorithm and parameters as StatENS) — or **`node:crypto` scrypt** (no
   dependency, different algorithm from StatENS). *Proposed: Argon2id.*
2. **JSON store now, a database in phase 4** behind the same interface — or
   SQLite now (`node:sqlite` is still experimental in Node 22). *Proposed: JSON now.*
3. **Roles owner / admin / member / viewer** with the rights table above.
   *Proposed: as written.*
4. **Step-up for host, users and org actions after 12 hours.** *Proposed: yes.*
5. **Tailscale identity** as an opt-in shortcut. *Proposed: yes, off by default.*
6. **Pairing before phase 1 ships:** the dashboard's pairing route stays open
   until then. *Proposed: phase 1 closes it; nothing separate.*
7. **A shared spec with StatENS** (E-lite in the 2026-09-25 audit): write the
   tables, token rules and parameters above as a short standalone document both
   projects follow. *Proposed: after phase 1, from what was actually built.*
