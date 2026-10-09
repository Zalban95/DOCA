# Production and development hives

**The owner's decision, 2026-10-09** (proposed as CONSTITUTION S15 — the constitution is the admin's to change, so the
text below waits for their yes):

> **S15 Safeties always apply in production.** "We can work on the repo without many safeguards on our machine, but
> the safeties always apply in the versions in production and the demo sandboxes." A development hive — the project's
> own, under the owner edition — lets its admin and their agents debug and change DOCA from within, as now. A
> production hive — a customer's, on our servers or theirs, and every demo or beta sandbox — holds every safety for
> everyone, its admin included ("like I can't ask you to crack your harness"): nobody and no agent changes DOCA itself,
> its charter or its guards. Inside a person's own projects, Auto and full auto just work: "a request with rights
> inherits the permission, otherwise a job never proceeds" — no extra prompts on work a person with the right started,
> and "don't stress customers with infinite logins". The licence's seats and devices apply in production only.
> Updates reach production hives from the project's channel, holding their work, now or on a schedule.

## Which one a hive is

One flag, decided structurally at start and never a setting (`modules/edition-mode.js`):

| Licence in effect | Hosted profile (`DOCA_PROFILE=hosted`) | Mode |
|---|---|---|
| carries `lab` or `all` (the owner edition, a tester's) | no | **development** |
| carries `lab` or `all` | yes | production |
| anything else, or none | either | production |

An install from before licensing keeps every feature for its 30 days of grace (`all`), so it is development until the
grace ends — those installs are the owner's and testers'. A new install with no licence is production. The mode is
shown in Settings → System → Licence (with why) and given to the agent as one line of its environment (`hive:
production — …` / `hive: development — …`), which sits in the stable prefix of the prompt.

## What differs in production

Nothing a person makes changes: projects, the workspace, devices, Auto and Unattended behave exactly as in development.
**No new question is asked of anyone**; what production adds are absences and refusals said in a sentence.

| | Development | Production |
|---|---|---|
| DOCA's code (the running version, the install, `.releases/`) | readable and writable by the file tools, as before | out of reach of every file tool and route: `read_file`, `write_file`, `list_dir`, `search_files` (matches inside it left out), `replace_in_files`, canvas, `show_media`, the Files routes, a project at it — `fmSafe` and `resolvePath` refuse with "this is DOCA's own code". The data kept beside the code (`.doca`, prefs, backups) stays reachable as before |
| The agent's `shell` | as before | a command line naming the code's folder, or run in it, is refused — a speed bump, not a wall: a command can spell a path another way. The hosted profile (no shell at all) is the wall |
| The lab: developer mode, experiments, evaluation sets, who may release | the licence decides | absent, whatever the licence says (`license.has('lab')` is false) |
| Updating from git (`POST /api/update`), the package check (`/api/deps`), promoting a specialist into the repository | there | absent (the panel's 404) |
| Versions | git tags as worktrees | only signed releases the update channel installed, and the checkout it was installed as (the way back, P17) |
| Release notes (ⓘ) | from git | from the signed manifest |
| Updates | git (Settings → General → Updates) | the update channel (below) |
| Seats and devices of the licence | shown, not held | held |
| The environment line `panel code: <path>` | there | replaced by the production line; the path is never named |
| Shipped skills and specialists | the repository's files | in the code, so out of reach; a hive's own copies (same name, in the skills and specialists folders) work as ever |

The charter and the guards were already code; in production the code is out of reach, so they cannot be changed from
inside either. What stays possible on a customer's own machine: the person at the machine (a terminal, an editor) —
the machine is theirs (S7). The Terminal tab is the person's own terminal and is kept; a hosted hive has none.

### Seats and devices

From the licence (`seats`, `maxDevices`), production only (`modules/license/limits.js`):

- **A seat** is a person with an active, unsuspended account — the owner included. Adding someone past it, or restoring
  a suspended person, is refused: "Acme's licence has 5 seats, and 5 people have an account. Suspend someone who no
  longer needs one, or ask for a licence with more seats."
- **A device** is a paired device holding a token and not revoked — phones, watches, desk and browser-extension
  clients, linked chats, agents, other hubs — **including one waiting for approval** (it holds a token and a place until
  someone refuses it). A signed-in browser's own record is not a pairing and never counts: signing in is never refused.
  Refused when a pairing starts (no code is minted) and when a device is made, so no route goes around it.

The auth lines changed for this are listed in the change's report: one call in `auth/users-routes.js` on create and
one on restore; the device limit is in `api-v1/devices.js` `create` and `startPairing`, `devices-panel.js` (to answer
409 with the sentence), `channels/converse.js` (to say it in the chat) and `api-v1/errors.js` (to pass the code).

## The update channel

**Source.** The project's licence server (Keygen CE, `doca-licensing`): its distribution API, asked with the hive's
licence key (`License <key>`), so only a licensed hive sees releases, and Keygen's own rules (an expired licence,
entitlement constraints on a release) apply. Each release carries in its metadata a **manifest** — version, sha256 and
size of the code's zip, data format, `urgent` and `applyBy`, notes, and for image hives the image and its digest — and
an **Ed25519 signature** of the manifest's canonical JSON (`modules/update-channel/manifest.js`).

**Why a release key of its own.** The licence's vendor key lives inside the licence server (Keygen signs licence files
with it). If the server were broken into, that key could sign anything; a release signed with it would send every
customer code to run. The release key (`npm run release-key` in doca-licensing) never goes near the server; the hive
trusts it through `modules/update-channel/keys.js` `RELEASE_KEYS`, in code like the vendor keys, and adding a key is the
admin's (S11). `urgent` and `applyBy` are signed with the rest, so nobody between can make an update urgent.

**The file.** A Keygen artifact (a licence-gated download: the server redirects to its S3-compatible storage, and the
hive follows without its key), or a `url` in the release's metadata when the server has no storage. Either way the zip
is checked against the signed sha256 and size before it is kept.

**On the hive** (`modules/update-channel/`): checked every six hours (and Check now). The newest verified release is
shown; any newer release marked urgent sets the earliest `applyBy`. Settings → General → Updates: **Install updates**
— only when I ask · tell me, I install (the default) · in a window (days, from–to, on the hive's own clock; a window may
run past midnight) — and **Update now**, **Call it off**.

When an update is due — asked now, inside the window, or past an urgent release's `applyBy` — it is **staged** at once
(downloaded, verified, unpacked into `.releases/vX.Y.Z` with its dependencies — linked from a version with the same lock,
else `npm ci` — and marked with its signed manifest), and **switched to once nothing runs**: running turns, voice calls
and devices' commands are waited for (`harness/drain.js`), with no deadline that would cut them, and no automatic turn
starts meanwhile. A window that closes before the hive is idle calls the wait off until the next window; an urgent
update keeps waiting. The switch is the existing one (`releases.use` → the launcher), so **a version that does not
answer within 90 s is put back by the launcher**; at the next start the channel sees it, says so in the activity log
and as a notice to the admins, and does not try that version again until someone asks.

**A development hive** keeps git and ignores the channel (its routes answer 409).

### A hive that runs the image

The container cannot replace its own code (the image is read-only, with no npm). The channel still checks, so its admin
sees what is coming; the host updates it:

```sh
deploy/hive.sh update <name> [--image IMAGE] [--timeout SECONDS]
```

With no `--image`, the hive's own channel names it (`node bin/doca-update.js latest` inside the container: the image
and digest from the signed manifest, pulled by digest). Then: the container's restart policy is set to no; the hive is
asked to stop once nothing runs (`bin/doca-update.js hold`, a file in its own data — no route, no token; the hive waits
on its work exactly as above, then stops); a backup of its volume is made (S9); the new image starts on the same volume
with the options it was made with (kept as the label `doca.hive.args`); if it does not answer, the old image starts
again on the same volume. If the hive is still working when `--timeout` (6 h) runs out, nothing changes and the request
is withdrawn.

## What the owner does to publish an update

Once, in doca-licensing: `npm run release-key` (keep `.secrets/release-signing.pem` safe, and a copy offline), and add
the printed public key to the hub's `modules/update-channel/keys.js` in a release (S11). `npm run sync -- --hub <checkout>`
sets the product's distribution to licensed. Optional: S3-compatible storage for artifacts (`AWS_*` in `.env`).

For each release, after the hub's `[X.Y.Z]` commit and `vX.Y.Z` tag:

```sh
npm run release -- --hub /path/to/doca --tag vX.Y.Z --notes "What it changes, in a sentence or two."
#   urgent (a security fix):  --urgent --apply-by 2026-11-01
#   no artifact storage:      --url https://…/doca-X.Y.Z.zip   (host the zip from out/releases/)
#   image hives:              --image registry/doca-hive:X.Y.Z --image-digest sha256:…   (after docker push)
npm run releases                     # what is on the channel; npm run releases -- yank X.Y.Z takes one off
```

Hives on customers' machines take it as each admin chose; hives we run take it with `deploy/hive.sh update <name>`.

## Backups

Settings → Backups: **On a schedule** keeps the last N scheduled backups (`backup.schedule.keep`, 1–365, shown as "Keep
the last"); **A second copy** (`backup.mirror`, never the agent's to propose) is a folder on this machine — another disk,
a NAS mount — checked writable when saved, where every backup is also copied (by hand or on the schedule), keeping the
same number of scheduled ones there. A copy that fails is an activity line and a notice; the backup itself stands. A
hosted hive has one volume: its host copies it (`hive.sh backup`).

## Open

- Whether the Terminal tab should leave a production hive on a customer's own machine (kept: the machine is theirs).
- An offline production hive has no channel: it is updated by installing a newer release by hand (or a signed zip
  uploaded in the panel, not built).
- Release keys must be added to the hub (S11) before any hive can verify an update.
