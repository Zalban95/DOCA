# Audit: the ComfyUI service would not start, and the `/basedir` the image expects the panel to own

**Author:** the resident DOCA harness agent on `al-Office-desk`, driving this panel from the
dashboard console. **Date:** 2026-09-30.
**Version audited:** the panel that served this session is **2.116.1** (`c446c41`, running from
`.releases/v2.116.1`); the change this audit accompanies is cut from that commit as **2.116.2**.
**Scope:** one service, one failure, one fix — and what the fix does *not* settle.
**Method:** read the panel's own start path (`modules/services.js`), the image's init and mount
list (`docker inspect`, `docker exec`), and the container's own API (`curl localhost:8188`).
Every claim below carries the command or the `file:line` that produced it.
**Applied by this work:** `modules/services.js` (uncommitted in the tree when this was written,
released as 2.116.2) plus a hot-patch to the running release copy
`.releases/v2.116.1/modules/services.js`. Nothing else was changed.

---

## 1. What happened, in order

1. The ComfyUI service was started from the panel's Services page. The container appeared, sat in
   `Up` for seconds at a time, and came back — `Restarts 119`.
2. Its state, read with `docker ps -a` and `docker inspect`:
   `doca-comfyui 33efbdf9e09c  Exit 1  Restarts 119`, no `/basedir` in `.Mounts`, and
   `curl -s -o /dev/null -w '%{http_code}' localhost:8188/` → `000` (nothing listening, ever).
3. The start path was read. For `id === 'comfyui'` it mounted `~/comfyui-data:/comfy/mnt` and the
   HuggingFace cache, and passed `-e WANTED_UID=1000 -e WANTED_GID=1000` — but did not mount
   `/basedir`, and did not create it.
4. The container was killed as a running failure and the panel's `handleStart()` was hot-patched
   (the panel that owns the bug serves from a release copy, so the fix has to reach that copy to
   take effect now, and the tree for it to survive the next release). The owner pressed Start.
5. The same command run from the tree produced a clean container, `f13319708071`,
   `Created 2026-09-30 21:00:35 +0200 CEST`, `Up`, `Exit 0`, `Restarts 0`, and 8188 answering.

## 2. The reading that fits, and the two that do not

The image runs one init script — the container's PID 1 is `/bin/bash /comfyui-nvidia_init.bash` —
and its last step is `comfy setup --project-dir /basedir`, run as `WANTED_UID`. The image never
creates `/basedir` itself; its README binds that path on every run, beside `/comfy/mnt`, which is
why the panel mounts `/comfy/mnt` the same way.

Two other candidates were excluded first, on evidence rather than on plausibility:

- **the application** — 8188 never answered at all, and the container's restart counter climbs:
  that is an init that exits, not an app that crashes after it starts. A ComfyUI that boots and
  dies would still have bound the port and been in `Up` long enough to answer `000` differently.
- **the GPU** — the container that *does* run reports `torch 2.14.1+cu130`, `cuda True` and both
  `RTX 5060 Ti 16311 MiB` in `/system_stats`, so the image's CUDA path is fine on this host.

What is left is the path, and it is the one the panel is responsible for: a step running as uid
1000 has to write an absolute path that lives on the host through a bind mount. A bind source that
does not exist is created by Docker for the mount — owned by root, which is exactly what a step
running as uid 1000 cannot write into. Whether the init fails on the ownership or on a path that is
not there at all, the cure on this side is the same, and is the one the image's README asks for:
**the host owns the directory, and passes it in.**

## 3. The fix

`modules/services.js:126-142`. The panel now, for `comfyui`:

- creates `~/comfyui-data/basedir` if it is missing and `chown`s it to the calling user's uid/gid;
- mounts it: `-v <comfyui-data>/basedir:/basedir`, beside the existing
  `-v <comfyui-data>:/comfy/mnt` and the HF cache mount.

Two details worth keeping, because each cost time somewhere:

- **the panel does this before `docker run`**, not in the image: the image cannot be asked to
  create the host's directory, and a container that creates its own mount source only fixes itself
  on the run *after* the first one succeeded — which never happens.
- `handleStart()` already removes a container of the same name (`docker rm -f doca-<id>`) before
  running a new one, so a start after a failed start is not blocked by the corpse of the last one.
  The failed container above was still visible precisely because nothing had replaced it yet.

## 4. Verified after the fix

| Check | Command | Result |
|---|---|---|
| container is up, not looping | `docker inspect` | `Up`, `Exit=0`, `Restarts=0`, `RestartPolicy=unless-stopped` |
| the mount the image wants | `docker inspect --format '{{range .Mounts}}…'` | `/home/al/comfyui-data/basedir -> /basedir` (beside `/comfy/mnt`, HF cache) |
| the host directory's owner | `stat` | `uid=1000 gid=1000 755` |
| the app answers | `curl -s -o /dev/null -w '%{http_code} %{time_total}' localhost:8188/` | `200` in `0.0039 s` |
| it is really ComfyUI, on the GPU | `curl -s localhost:8188/system_stats` | `comfyui_version 0.38.0`, `python 3.12.3`, `torch 2.14.1+cu130`, `cuda True`, `ram_total 66143682560`, 2 × `RTX 5060 Ti 16311 MiB` |
| the queue route exists | `curl -s localhost:8188/queue` | `{"queue_running":[],"queue_pending":[]}` |
| the submit route exists | `curl -s -X POST -d '{}' localhost:8188/prompt` | `{"error":{"type":"no_prompt",…}}` — the route answers and refuses an empty graph |

## 5. Not verified, and not fixed by this

- **There is no checkpoint.** `GET /object_info/CheckpointLoaderSimple` returns an empty
  `ckpt_name` list, and a `find` for `*.safetensors` / `*.ckpt` over the host and inside the
  container turns up nothing of any size. So: the service starts, the API answers, the queue is
  empty — and **no text-to-image graph can run**. The panel started the tool; it did not give it a
  model. Which weights to fetch (size, licence, which model) is the owner's decision, not a
  default to assume.
- **The generation path has not been walked once.** Submit → `history` → a file in
  `~/comfyui-data/ComfyUI/output/` is still unproven end to end. "The service starts" and "the
  service generates" are different claims and only the first one is checked here.
- **Ref2VA-VSA** (the custom-node pack researched earlier) is identified but not installed, so the
  reference-to-video work it enables is not on this host yet.
- **The running panel still serves the hot-patched copy.** Until the panel is updated and restarted
  it reports 2.116.1 and carries the fix only because that copy was edited by hand — `/api/update`
  already says a running process reports what it is running.

## 6. Why this is committed now — the reasoning behind the release

The panel that had the bug serves from `.releases/v2.116.1/`, a copy. Patching the copy fixed the
panel in front of the person at that moment and **nothing else**: a release cut from `origin/main`
would not have carried it, and the next start after a fresh release would have restart-looped again.

At the same time the fix sat uncommitted in the working tree, on a branch
(`fix/comfyui-basedir-mount`) whose history is `v2.113.0` — 34 commits behind `origin/main`
(`c446c41`, `v2.116.1`). So the release is cut from `origin/main`, and it is a patch: a service
that exits is fixed, not changed in behaviour. `package.json` stays the only source of truth and
the OpenAPI description is regenerated in the same commit, as `test/openapi.test.js` insists.

The repo's own convention (its `AGENTS.md`, "Version discipline") is what this follows: one branch
per task, one logical change per commit with the reason in the message, the release commit prefixed
`[2.116.2]`, and an annotated tag `v2.116.2` with a message — `git tag -a … -m …`, never `-a`
alone.

## 7. Open with the owner

1. **Which checkpoint to fetch**, and where it should live (a download of gigabytes). Until then
   the tool runs and cannot draw.
2. **Whether to update the running panel to 2.116.2 once it is released** and restart it, so the
   fix arrives by release rather than by hand-patch.
3. **Ref2VA-VSA**: install or not, given what it needs (settled earlier, still open).
