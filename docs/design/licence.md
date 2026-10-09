# The licence (3.0)

Decided by the owner on 2026-10-09: **one build for every customer, everything included; the licence enables the
specific functions** — structurally. An unlicensed feature's tables are not created, its routes are not mounted, its
tools are absent and its pages are not drawn. The licence server is **Keygen CE**, self-hosted, in the private
repository `doca-licensing`, which runs on this machine (a container bound to loopback or the tailnet) or on a VPS.
Every address is a setting: the company's domain will change.

## What a licence enables

Every feature in the index (`modules/features/data/*.js`) names one **code**. A code is a Keygen *entitlement*; an
**edition** is a Keygen *policy* whose licences carry a list of entitlements. So the per-feature code is fixed in the
product, and editions are only lists — a new edition is made on the licence server, never in a release.

| Code | What it enables |
|---|---|
| `core` | Every hive's, licensed or not: the agent and its structure (Orchestrator, work chats, plans, memory, skills, recipes, schedules, reminders), projects, files, terminal, logs, Chronicle, traces, the Archive, models and providers, MCP, inference services, approvals, users, levels and grants, spending, packs (export and import), backups, updates, the guided set-up, the feature index |
| `agents` | Specialists on missions, the scout, finished missions put away |
| `voice` | Speech services and a screen's voice, the calls (Live, Deep, a device's), voice messages, the face, the ambient screen |
| `devices` | Paired clients and the device API (`/api/v1`), asking and telling a device, files to a device, DOCA's apps, doca-client, the browser extension, wearables, secrets used on a device, DOCA as an MCP, AG-UI and A2A agent |
| `channels` | Telegram, Matrix, Slack, mail |
| `machines` | Agents' computers, VMs, VNC screens, Docker, Live, logins for computers |
| `home` | The Home page and smart-home control |
| `services` | Connected accounts (OAuth), keys for services and `api_call`, API services, the agent's service drafts |
| `library` | Packs sent between hubs, offering what was learned to the project |
| `lab` | Developer mode, every experiment, evaluation sets — for the project's owners and testers (CONSTITUTION S5) |
| `all` | Every code, including the lab and whatever later releases add — the project's own hives |

A licence can also carry `feature.<id>` to sell one feature without its group.

### Editions (a proposal; `license/codes.js EDITIONS`)

| Edition | Codes (`core` implied) | For |
|---|---|---|
| Essentials | — | the general assistant on its own |
| Personal | voice, devices, channels, home, services | a personal assistant across a person's devices and home |
| Studio | agents, machines, services, devices, library | teams of agents with their own computers, for work |
| Hosted | agents, voice, devices, channels, services | a hive on a server with no GPU or hypervisor: what needs neither |
| Complete | every code but `lab` (as listed in this release) | everything a customer can have |
| Owner | `all` | the project's own hives and testers |

## How it is read

- **The file** is a Keygen *machine file* (`-----BEGIN MACHINE FILE-----`), the licence checked out for this hive's
  fingerprint: `base64+ed25519`, or `aes-256-gcm+ed25519` encrypted under sha256(licence key + fingerprint). The
  signature over `machine/<enc>` must verify with one of `license/keys.js VENDOR_KEYS` — the Ed25519 public keys of the
  Keygen accounts that issue DOCA licences, in code, a list so a key can rotate (add the new one in a release, re-issue,
  remove the old in a later release). A plain licence file is accepted only when its metadata says `anyMachine: true`.
- **The fingerprint** is sha256 of the hive's own id (random, `keys/hive-id`) and the OS's machine id: a data folder
  copied to another machine, or restored there, is another hive.
- **Read once at start.** What is granted is decided at the first question after the hub starts and kept, because it
  shapes the router, the tables and the panel. A new licence takes effect at the next start; the panel says so.
- **Read-only is live.** A licence past its expiry, its file's expiry, or a check-in it missed keeps its features for
  the grace (`licence.graceDays`, 14, never more than the licence's `maxGraceDays`, 30 when unsaid); then every route
  of a licensed feature that changes something answers 403 `licence_read_only`, and its tools that act are refused.
  Reading goes on; nothing is deleted; the core is never read-only. A licence the server says is suspended or revoked,
  and a clock set back past the latest time the hive has seen, are read-only at once.

## Issuing, renewing, revoking

With `doca-licensing` (its README is the step-by-step):

1. **Sync** the codes from a hub checkout: `npm run sync -- --hub <checkout>` creates the product, one entitlement per
   code, and one policy per edition with its entitlements.
2. **Issue** for a customer: `npm run issue -- --edition studio --customer "Name" [--expiry 2027-10-01] [--seats 5]`
   prints the licence key. The customer enters it in Settings → System → Licence with the server's address.
3. **Online**: the hub validates the key, activates its machine (fingerprint) the first time and checks out a machine
   file whenever a quarter of the check-in interval has passed (at most daily). **Offline**: the customer copies the
   fingerprint from Settings → System → Licence; `npm run issue -- … --fingerprint <fp> --out hive.lic` activates that
   machine and writes its machine file, which they upload there.
4. **Renew**: `npm run renew -- <licence>` (expiry moves on); an online hive picks it up at its next check-in, an
   offline one gets a new file (`npm run file -- <licence> --fingerprint <fp>`).
5. **Revoke**: `npm run revoke -- <licence>` (or `suspend`). An online hive learns it at its next check-in and turns
   licensed features read-only; an offline hive's file runs until it expires — keep offline files short-lived.

## Existing installs, and the owner's hive

An install set up before licensing is given every feature for **30 days** from the first start of a release with
licensing (migration `3.0-licence-grace`, `keys/licence-grace.json`; never past 2027-01-31, so deleting the file buys
nothing after that day), with a banner "No licence yet — add one before <date>". Past it, licensed features are
read-only at once, and the next start runs the core. A new install has no grace.

The owner's own hive needs a real licence from the owner's server with the `owner` edition (`all`) before the 30 days
end; until the release that names the server's public key, no licence verifies.

## Development and CI

Tests sign their own licences: `test/licence-trust.js` trusts a test key whose private half is in
`test/fixtures/licence`, and preloads a licence for `all`; `test/helpers.js` loads it and puts it in `NODE_OPTIONS`
for every node process a test starts. Nothing in `modules/` trusts the test key or reads an environment variable to
— a process that loads that file is a patched product by definition. The installers' copy from a checkout leaves `test/` out; a git clone and the release worktrees still hold it
(in the working tree and in history), and nothing at runtime needs it. `npm run smoke -- --core` drives the panel
with no licence and fails on any call to a route that is not there.

## Honest limits

DOCA runs on the customer's machine, from source. A customer with the code can patch the check out — remove the
prune, add a key. The licence is not DRM; it is what the contract refers to, and what the project's own services
(updates, model suggestions, the pack registry, anything at the edge) will ask for: those services check the licence
key with the licence server before they serve a hive. Seats and devices are read from the licence and shown; they are
not yet enforced (enforcing seats touches `modules/auth`, which asks first).

## Keygen's licence (Fair Core License)

Keygen CE is used as published, to license our own product — which its licence allows. We keep its notices, do not
remove or circumvent its EE licence-key checks, and do not offer it to others as a hosted licensing service.
