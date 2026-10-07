# DOCA

DOCA is a harness and a hub for AI agents. You talk to it as you would to an assistant — in a browser, on your
phone, on your watch, out loud — and its agents do the work: coding, designing, the paperwork in between. It runs
on the open model you choose, on this machine or through a provider, and gives that model the structure — tools,
skills, recipes, specialists, its own computers to work in — that lets a mid-size model do what a frontier one does
alone. Everything it does is visible as it happens, every device you install it on becomes part of the hive, and
anything that governs it waits for your click.

## Install

You need **Node.js 22.5 or newer** (the installers check, and say how to get it). One command per system:

```bash
# Linux (systemd) and macOS (launchd)
curl -fsSL https://raw.githubusercontent.com/Zalban95/DOCA/main/scripts/install.sh | bash
```
```powershell
# Windows (Task Scheduler, at sign-in): from a copy of this repository, or with install.ps1 downloaded
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The installer fetches DOCA into `~/doca` (Windows: `%USERPROFILE%\doca`), installs its dependencies, asks once
whether what your agents learn may be offered to the project (nothing is ever sent without your click; when it
cannot ask, Settings → Packs does), makes it start at boot (on Linux a systemd unit, so `sudo` asks for your
password), starts it and waits for it to answer. Options — after `bash -s --` when piped: `--dir PATH`, `--no-boot`,
`--no-start`, `--share yes|no`, `--from <checkout>` (`-Dir`, `-NoBoot`, `-NoStart`, `-Share`, `-From` on Windows).
The port is 4242; to use another, put `PORT=…` in a `.env` file in the install folder and restart it.

Docker, Ollama, GPUs, Tailscale and the rest are optional: DOCA uses what the machine has and says what is missing.
Settings → System → System tools installs them with this system's own package manager.

## First run

1. Open **https://localhost:4242** on the machine itself. The certificate is self-signed (unless the machine is
   on a Tailscale network, which gives it a real one): your browser asks once.
2. **Create the owner** — your name, email and a password of ten characters or more. From another device the
   first sign-up also asks for a setup code: open the panel there, then read the code in `.setup-code` in the
   install folder, in the panel's log, or with `./run.sh setup-code`.
3. **Guided or Advanced.** Guided asks what you want DOCA for, looks at the machine and proposes only what fits: a
   model it can run (each install waits for your click) or an online provider (you paste a key). Advanced is every
   setting by hand. Either way, **Settings → Set-up** brings the guided set-up back.
4. Until DOCA's agent has a model, the chat says so and points to Set-up. Once it has one, talk to it with the
   round button in the corner of every page.

## Where things are

| Group | Pages |
|---|---|
| **Controls** | the agent harnesses and the containers; Ambient, a screen to leave on |
| **Agents** | Harness (the Orchestrator, work chats, specialists, memory), Workstream (what the agents are changing, live), Projects, Archive, Chronicle |
| **Machines** | Live, the agents' own Computers, VMs, Docker |
| **Hub** | Files, Terminal, Logs of the machine DOCA runs on |
| **Field** | Models, MCP servers, Connectors (your accounts), API keys and paired devices |
| **Settings** | General (account, look, updates, start at boot), Set-up, Users, Backups, Voice, System, … |

Phones, watches and other computers join through **Field → API keys** (pair with a QR code): DocaMobile on
Android, DocaWear on Wear OS, DocaDesk on Windows, and `clients/node` for any Linux, macOS or Windows machine.

## Updating

**Settings → General → Updates** says whether a newer version exists and installs it; the version list there
switches to any release and back, and a version that does not come up is put back by itself. A switch waits for
work in progress to finish unless you say *now*, and asks for your password. From a shell: `./run.sh versions` and
`./run.sh use vX.Y.Z`. Versions need an install made with `git clone` (the installers' default).

## Backing up

**Settings → Backups → Back up now** writes everything this install is — conversations, memory, devices, settings,
keys, attachments — into one `.dBac` file, password-protected by default (AES-256, opens in 7-Zip, WinRAR and
Keka). Backups can run daily or weekly, and be copied to any S3-compatible store. Restore checks the file first and
keeps a copy of the current state before replacing anything. Try a restore on a spare install, never on the one you
are using.

## Running it for real

[docs/production.md](docs/production.md) is the checklist: who may connect, the certificate, backups, updates,
logs, the switches that ask for your password, and what is off until you turn it on.

## Documentation

- [docs/production.md](docs/production.md) — running DOCA for real
- [docs/reference.md](docs/reference.md) — the panel in detail: harnesses, the agent, MCP, VMs, environment variables, project structure
- [docs/api/](docs/api/README.md) and [PROTOCOL.md](PROTOCOL.md) — `/api/v1`, for devices and agents (OpenAPI at `GET /api/v1/openapi.json`)
- [docs/design/](docs/design/) — why things are the way they are
- [CONSTITUTION.md](CONSTITUTION.md) and [AGENTS.md](AGENTS.md) — the project's rules, and how the code carries them out (read these before changing DOCA)

## Developing

There is no build step: `npm install`, then `npm run dev` (reloads on change) or `./run.sh`. `npm test` runs every
suite with no external services; `npm run smoke` opens every page in a headless Chrome, Edge or Chromium.
