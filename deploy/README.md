# Deploying a hive

A **hive** here is one DOCA running for someone else — a customer on a provider's server, a demo or a beta tester on
this machine — in a container of its own, from one image, in the **hosted profile**: the machine it runs on is not
theirs. Nobody using the hive, and none of its agents, can read DOCA's code or use that machine; they work in the
hive's workspace, in the agents' computers when those are given, and on their own paired devices.

Your own DOCA (installed with `scripts/install.sh` or `install.ps1`) has no profile and is not changed by any of this.

## What is in the kit

| File | What it is |
|---|---|
| `Dockerfile` | The image: Node 22 slim, `npm ci --omit=dev`, node-pty built in a first stage, only the files that run (`.dockerignore` leaves out tests, history, docs, notes). No shell, no git, no npm in it; runs as `node` (uid 1000), the code read-only and root's; `tini` is PID 1; a health check asks `/api/branding`. |
| `deploy/hive.sh` | Hives on one machine: `new`, `list`, `start`, `stop`, `code`, `backup`, `restore`, `remove`. |
| `deploy/compose.yml` + `hive.env.example` | One hive with Docker Compose — the same container, for a server you manage with compose. |

Everything a hive keeps is in one volume at `/data`: settings (`/data/.dashboard-prefs.json`), data (`/data/doca`),
the workspace (`/data/workspace`), backups made from its panel (`/data/backups`), its certificate and the one-time
setup code. Each is set by the image's environment, which wins over a saved path, so nobody can point the workspace
at the code from the panel.

## A demo hive on this machine, in one command

```sh
docker build -t doca-hive .                 # once, in DOCA's folder (or pull it, below)
deploy/hive.sh new demo                     # → https://127.0.0.1:4310 and a one-time setup code
```

`new` picks the first two free ports from 4310 (the panel's, and the canvases' beside it — `--port N` to choose),
binds them to `127.0.0.1` (`--bind <tailnet address>` to share it on the tailnet), waits until the hive answers and
prints the address with **a one-time setup code**: open it, enter the code, make the hive's owner. There is never a
default password; `hive.sh code demo` prints the code again until the owner exists.

Each hive gets its own container (`demo`), volume (`demo-data`) and network (`demo-net`), no folder of this machine,
all capabilities dropped, a read-only root, and limits: `--cpus 2 --memory 2g --pids 512` by default. When Docker has
**gVisor** (`runsc` in `docker info`), hives run under it, a kernel of their own; otherwise `hive.sh` says it runs
under runc, sharing this machine's kernel (`--runtime runsc` insists on gVisor and stops if it is missing).

```sh
deploy/hive.sh list                         # every hive, with its ports and runtime
deploy/hive.sh backup demo                  # → ~/doca-hives/backups/demo-<time>.tgz (stopped for the copy)
deploy/hive.sh restore demo2 <file>         # a NEW hive from a backup; never onto one that exists
deploy/hive.sh remove demo                  # asks, backs it up, removes container, volume and network
```

`DOCA_HIVE_IMAGE` names the image (default `doca-hive:latest`), `DOCA_HIVE_BACKUPS` the backups folder.
`hive.sh` touches only containers, volumes and networks it made (label `doca.hive`). On Windows, use Docker Desktop
with `compose.yml`, or `hive.sh` from WSL.

### This machine's services

A container reaches this machine at its network's gateway, so a service of yours that listens on **every** interface
is reachable from a hive (one on `127.0.0.1` is not). `hive.sh new` therefore puts rules on the hive's bridge —
answers to what it asked for, the ports `--models` lists, nothing else — when run as root; otherwise it prints the
`iptables` lines to apply. `FIREWALL=0` skips them. `remove` takes them away again.

### Local models for a sandbox (until the model gateway)

Off by default: a hive uses the providers its owner adds keys for. To let a hive use this machine's inference:

```sh
deploy/hive.sh new demo --models 11434,8080
```

The hive then reaches this machine at one name, **`models.host`** (Docker's `host-gateway`), and — with the firewall
rules above — only on those ports. In the hive, add the provider in Field → API keys at `http://models.host:11434/v1`
(Ollama) or `http://models.host:8080/v1` (llama.cpp). The service must listen where the bridge reaches it: Ollama with
`OLLAMA_HOST=0.0.0.0` (or the bridge's address), a llama-server with `--host 0.0.0.0` — and then it is the firewall
that keeps other containers and other hives off it.

## The hosted profile

`DOCA_PROFILE=hosted` is set by the image, read once when DOCA starts and never a setting: no person in the panel and
no agent can turn it off (`modules/hosted.js`). What a hosted hive does not have — absent, not refused: the routes
answer the panel's own 404 before any handler, the tools are not in the agent's list, the pages are not drawn:

- **Pages:** Terminal, Files, Docker, VMs.
- **The agent's tools:** `shell`, `shell_job`, `hub_command`, `git`. The file tools (`read_file`, `write_file`,
  `list_dir`, `search_files`, `replace_in_files`, canvases, `show_media`, files sent to a device) reach only the
  workspace — by its real path, so a link out of it is refused — and never the code's folder.
- **Routes:** the Files tab's machine list (its file routes stay, inside the workspace, for Projects and canvases);
  config files and setup scripts; snapshots; saving paths; System tools; installing or configuring a CLI or custom
  harness; model tools, local model installs, Hugging Face downloads; OpenClaw's skills hub; the OpenClaw stack,
  Docker, inference services, llama.cpp servers, VMs; start at boot; updating from git, outdated packages, switching
  versions; a device console's buttons; building DOCA's apps from a folder; the wake-word trainer's and System 1's
  setup; Projects' commands, environments, git and language servers.
- **Sockets:** the terminal, a CLI harness's terminal, language servers, VM consoles.
- **Elsewhere:** an MCP server run as a command (stdio) cannot be added, imported or started — servers at an address
  can; install proposals are only Ollama models; devices' hub commands lose the stack, containers, services, llama.cpp
  and snapshots; no command line is typed into the machine and no other agent program is run on it.

**Agents' computers** need Docker, which a hive is not given, and the image carries no Docker CLI: the Computers page
says Docker is missing, and work happens in the workspace and on paired devices. Docker-in-the-host is never handed to
a tenant — its socket is the whole machine. What giving hives computers would take (not built yet): a Docker socket
proxy per hive that allows only containers named `doca-computer-<hive>-*` (create, start, stop, exec, cp, inspect,
remove — refusing `--privileged`, host mounts, host networking and every other container), the Docker CLI in the image
pointed at it with `DOCKER_HOST`, and the computers' image built or pulled on the host beforehand.

**Machine rights.** A request that arrives through the published port comes from the container's gateway; a hosted
hive counts that as the machine itself (as loopback is for an ordinary install), so its owner manages the hive. The
port is published on `127.0.0.1` or the tailnet — the door the deploy chose; anything else on the container's network
is outside (`network.lanAdmin` then decides, as on any install).

## On a provider's server

The same image on a VPS with Docker and Compose:

1. **A private registry.** The code stays private: push the image to a private GHCR package, never a public one.
   ```sh
   docker build -t ghcr.io/<owner>/doca-hive:<version> .
   echo "$GHCR_PUSH_TOKEN" | docker login ghcr.io -u <owner> --password-stdin   # a token with write:packages
   docker push ghcr.io/<owner>/doca-hive:<version>
   ```
   On the server, log in with a **read-only** token: GitHub → Settings → Developer settings → Personal access tokens
   (classic) → `read:packages` only (or a fine-grained token with Packages: read on that package). Keep it in the
   server's Docker credential store (`docker login ghcr.io`), never in a file in this repository or in `hive.env`.
2. **One hive:** copy `deploy/compose.yml` and `deploy/hive.env.example` (as `hive.env`) to the server, set
   `DOCA_HIVE_IMAGE=ghcr.io/<owner>/doca-hive:<version>`, then
   `docker compose --env-file hive.env -f compose.yml up -d`. The setup code: `docker exec <HIVE_NAME> node -e
   "console.log(require('fs').readFileSync('/data/.setup-code','utf8'))"` after the first visit, or `hive.sh code`.
   Several hives on one server: `hive.sh` with `DOCA_HIVE_IMAGE` set does the same per hive.
3. **TLS and the address.** Until the edge (v3.2) is in front of hives, bind to `127.0.0.1` and reach the hive through
   an SSH tunnel, or bind to the server's tailnet address. Do not publish it on the internet with its self-signed
   certificate. The address and domain are not in the image: they are `HIVE_BIND`, `HIVE_PORT` and, when there is a
   domain, the edge's — nothing to rebuild when they change.
4. **Updating** a hive is a new image on the same volume, holding its work: `hive.sh update <name>` (below). With
   compose: `docker exec <name> node bin/doca-update.js hold` (it waits until nothing runs, then the hive stops),
   `hive.sh backup <name>`, then `docker compose pull && docker compose up -d`.

## Updating a hive (docs/design/production.md)

```sh
hive.sh update <name> [--image IMAGE] [--timeout SECONDS]
hive.sh update <name> --file doca-update-X.Y.Z.dupd [--go-back]   # a hive with no way to the update channel
```

A hosted hive is a production hive: its update channel (the licence server's signed releases) says what is newer, and
with no `--image` the hive names it itself — `node bin/doca-update.js latest` inside the container, the image and the
digest from the signed manifest, pulled by digest. The hive's work is held: its restart policy is set to no, it is
asked to stop once nothing runs (`bin/doca-update.js hold`: a file in its own data — turns, calls and devices' commands
are waited for, never cut), a backup of its volume is made, and the new image starts with the options the hive was made
with (the label `doca.hive.args`). If the new image does not answer within two minutes, the old one starts again on the
same volume and the backup's name is said. Still working when `--timeout` (6 h) runs out: nothing changes.

**Offline**, with an update file from whoever supplies DOCA (`doca-update-X.Y.Z.dupd`, made with the image): the hive
checks its signed manifest against the release keys in the code it runs, the image it carries is checked against the
signed sha256 and loaded with `docker load`, and the update goes on as above. An older version needs `--go-back`; a
file without an image (one for a hive installed from code) is refused with that reason.

## What a tenant can still see

- **The panel's own page** — `public/`, the HTML, CSS and JavaScript every browser downloads to draw it. That is
  front-end code by nature; the server's code (`modules/`, `server.js`) is not reachable.
- **Shipped skills and specialists** — their instructions are what agents read to work (`skills/`, `specialists/`).
- **The clients a device downloads** — doca-client (`/api/v1/clients/node`) and the browser extension's zip are
  shipped to devices by design.
- **The version** — `package.json`'s number in the panel and `/api/update-check`.
