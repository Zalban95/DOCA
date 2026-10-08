# Running DOCA for real

A checklist for a DOCA that people rely on: a hub that stays up, is reachable only by whom it should be, can be
brought back, and changes only when its owner says so. Each item names where it is set and what it does by default.
Install and first run are in the [README](../README.md).

## Who can reach it

- [ ] **How it listens.** Settings → System → Network, or `DOCA_LISTEN` in `.env` (the environment wins, and the
  panel says so beside the field). Read at start, so a change needs a restart.
  - `tailnet` (the default) — this machine and its Tailscale network. Without Tailscale this means this machine
    only.
  - `local` — this machine only; reach it through `tailscale serve` or an SSH tunnel.
  - `lan` — also the local network (private addresses at both ends), so a phone on the Wi-Fi pairs without
    Tailscale. From outside loopback and the tailnet, the machine's rights (admin, users, devices…) are refused
    unless you allow it (`network.lanAdmin`, same page): a person there can read and chat.
  - `all` — every interface. A choice for the owner to make deliberately, not a fix for a connection problem.
- [ ] **The services DOCA starts** (Whisper, Kokoro, ComfyUI…) publish their ports on this machine only
  (`network.services`: `local`). Widen it only if something else must reach them: those ports have no sign-in.
- [ ] **Accounts.** Every page and request needs a signed-in person; the machine's own pages (terminal, files,
  Docker, models, MCP, keys, users) ask for the password again when the sign-in is over 12 hours old. Give other
  people the lowest level that does their job (Settings → Users: Viewer, Member, Admin, or a level of your own).
- [ ] **Devices** pair from Field → API keys with a one-time code; each gets its own token, revocable there. Set
  `DOCA_LEGACY_TRUST=0` to issue tokens only from the host's shell (`npm run token`).
- [ ] **Locked out:** `./run.sh reset-password <email>` on the host prints a one-time password (Linux and macOS).

## The certificate

DOCA serves HTTPS only. On a machine on a Tailscale network with HTTPS certificates enabled, it asks Tailscale for a real certificate
for its `*.ts.net` name and renews it before it expires; otherwise it makes a self-signed one, which each browser asks
about once. Both live in `.certs/` in the install folder and are never in a backup: a restored machine makes its
own. Plain HTTP happens only if no certificate can be made at all.

## Backups, and restoring

- [ ] **A backup exists.** Settings → Backups → Back up now: conversations, memory, devices, settings, `.env`,
  keys, specialists and attachments, in one `.dBac` file under `backups/` in the install folder
  (`DOCA_BACKUP_DIR` moves it).
- [ ] **Encrypted.** A password is on by default (AES-256 zip). Without one, the file carries every key and
  conversation in the clear, and the panel says so. A saved password lives in `.backup-password` (mode 0600).
- [ ] **On a schedule.** Off by default: daily or weekly at a set time, keeping the last 7 (Settings → Backups).
  A scheduled encrypted backup needs the saved password; without one it is not made, and the page says why.
- [ ] **Off the machine.** An S3-compatible store (AWS, Backblaze B2, Cloudflare R2, MinIO…) can receive each
  scheduled backup, keeping the last 14 there; off by default, encrypted backups only unless you change it.
- [ ] **A restore has been tried — somewhere else.** Restoring replaces the hub's whole state and restarts it, so
  try it on a spare install, never on the hub people are using: install a second copy beside it
  (`scripts/install.sh --dir ~/doca-trial --no-boot`, with `PORT=4300` in the environment so it does not take the
  real hub's port, and `--no-boot` so it does not take its boot entry), upload the backup in its Settings → Backups
  and restore it there. A restore checks the password, the data format (a backup from a newer DOCA is refused) and
  every file's checksum before anything is replaced, and keeps a `…-before-restore.dBac` of what it replaced.
- [ ] **Settings alone** are also kept as checkpoints, the last 200 changes (Settings → System → Checkpoints).

## Updates and versions

- [ ] **Installed with git.** Updates and version switching need an install made by `git clone` — the installers'
  default. One copied with `--from` has no versions, and Settings → General → Updates says so.
- [ ] **Updating.** Settings → General → Updates checks the project for a newer release and installs it. Only the
  owner (the `org` right) updates, switches versions or restarts.
- [ ] **Switching versions** asks for your password, every time. Every release is in the list; a version is
  installed beside the code (`.releases/vX.Y.Z`) and every version reads the same data. One that does not answer
  within 90 seconds is put back by the launcher. From a shell on Linux: `./run.sh versions`, `./run.sh use vX.Y.Z`,
  `./run.sh use checkout`. On Windows and macOS, where there is no run.sh, the way back when the panel will not load
  is to delete `.releases/current` in the install folder and start DOCA again: it starts the working copy.
- [ ] **Nothing is cut off.** A restart or a switch waits until no turn, voice call or device command is running
  (at most 30 minutes) unless the person asking chooses *now*.
- [ ] **Started by the launcher.** Switching needs DOCA started by the installer, `./run.sh`, the boot entry or
  `node bin/doca-launch.js start` — not `npm start`.
- [ ] **Start at boot.** Settings → General → Start at Boot, or `node bin/doca-launch.js enable|disable|status`:
  a systemd unit (`openclaw-panel.service`) on Linux, a Task Scheduler entry at sign-in on Windows, a launchd agent
  on macOS. One machine has one such entry; the page says when it starts a different DOCA folder. On Windows the
  entry is the person's own (no administrator needed), has no time limit and opens no window.

## Logs and what is kept

- [ ] **The panel's own output**: `journalctl -u openclaw-panel` under systemd; `restart.log` in the install
  folder under launchd on macOS and the Task Scheduler entry on Windows; `doca.log` in the install folder when the
  installer started it itself (with `--no-boot`). A restart without a supervisor writes its successor's start to `restart.log`.
- [ ] **What is kept of what happened** (Settings → System → Logs): the log lines held in memory (500 for the
  harness, 300 for the Workstream, 200 per MCP server), the record of each turn, mission and device job (90 days),
  the hub's own activity (30 days), background jobs (the last 50) and evaluation results (30 per set). Each turn's
  trace — names and numbers, never content — is kept 30 days (`tracing`). Logs carry tool argument names, never
  their values.
- [ ] **Usage**: every model call is counted per person (Settings → Spending); budgets are off until you set one.

## The switches that ask for your password

Whoever changes how much the agents may do types the password for that change, even when signed in: the approval
mode and its always-allowed list, a conversation's own approval switch, the specialists switch, developer mode and
experiments, who may release unasked, sharing with the project, how the hub listens, levels, reach, grants and
accounts, the guards, restoring a settings checkpoint, switching the version, bringing a pack in, spending budgets
and permissions, and what is kept in the logs. The agent can propose these; it never applies one.

## What is off until you turn it on

| What | Default | Where |
|---|---|---|
| Specialists (the agents a work chat can send) | off | Agents → Harness → Specialists |
| Developer mode, and with it every experiment | off | Settings → Developer |
| Offering what the agents learn to the project | asked at install; off when declined, undecided when not asked | Settings → Packs |
| Scheduled and off-site backups | off | Settings → Backups |
| Spending budgets | none | Settings → Spending |
| Listening beyond this machine and the tailnet | off (`tailnet`) | Settings → System → Network |
| Models releasing unasked | nobody | Settings → Developer |
| MCP servers, connectors, channels (Telegram, Matrix, Slack, mail) | none until you add them | Field → MCP, Field → Connectors, Settings → Channels |

**On by default:** the approval mode is *Auto* — the agent's tools run without a question, while what is always
asked is asked in every mode: signing in with a stored login, a computer's or device's tool called with `confirm`
(paying, submitting, signing in), and a hub command marked to confirm. Choose *Manual* with the mode switch in the
Harness tab's header (⚡ Auto) to be asked about every call that does something. Traces of each turn are kept
(30 days).
