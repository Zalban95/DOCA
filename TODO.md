# TODO

Known rough edges, deliberately deferred. Each one is small and independent —
none of them break anything today.

## MCP and VMs, deliberately left out of the first pass

- **No embedded VNC console.** The VMs tab shows the display address to paste
  into your own viewer. Doing it in-page needs a websockify-style proxy plus a
  JS VNC client, which is a feature of its own rather than a detail of this one.

- **No VM creation.** Management only. A create wizard would have to mask
  `virt-install` / `VBoxManage createvm` and their disk, ISO and network
  arguments — worth doing, but not while the panel could not yet start a VM.

- **MCP HTTP transport is best-effort.** `modules/mcp/client.js` implements
  streamable HTTP well enough for a server that answers a POST with JSON or a
  single SSE frame, and it echoes `Mcp-Session-Id`. It does not hold a
  long-lived event stream open, so a server that pushes notifications (tool
  list changes, sampling requests) will not be heard. stdio is the tested path.

- **MCP servers are not reachable from the `/api/v1` client layer** — no phone
  or watch can list or call them. Only the built-in harness sees their tools.

- **Settings proposals are panel-only too.** A pending change is drawn in the
  Harness console and nowhere else, so a proposal made while you are on your
  phone waits until you open the dashboard. The `/api/v1` prompt machinery
  (`modules/api-v1/prompts.js`) is the natural home for it.

- **A proposal is not tied to the conversation that made it.**
  `settings.propose()` accepts a `sessionId` but the tool has no way to pass one,
  so the card is not filed against the transcript it came from. Harmless with one
  conversation open, confusing with several.

## Settings consistency

- **Status lines clear on four different schedules.** `3000ms` is the de facto
  convention (`public/js/snapshots.js:122`, `files.js:497`, `models.js:76`),
  but `setup.js:52` uses `4000`, `llamacpp.js:264` uses `5000`, and most panels
  never clear at all. Pick one rule — probably "success fades, errors stay" —
  and put it behind an option on `setStatus()` instead of a `setTimeout` per
  call site.

- **"Restart to apply" is worded differently everywhere it appears.**
  `keys.js:49` says "restart OpenClaw", `paths.js:77` says "restart DOCA",
  `settings.js:403` says "Restart the server". The first one means the external
  stack and the other two mean this process, which is a real distinction worth
  making with consistent words rather than three phrasings.

- **Shell scripts are editable in two places:** the Setup panel (which lists all
  four, creates missing ones, and can run them) and the Config tab's file list.
  This is tolerable because the Config tab is a generic editor that can open any
  path via favourites, but note that `setup-phase2.sh` appears in the Setup panel
  and in `ALLOWED_SCRIPTS` while being absent from `CONFIG_REGISTRY`. Either
  decide the Config tab does not list scripts, or list all of them.

## Errors that surface as the wrong thing

- **`modules/files.js:79`** `statSync` on a custom config favourite whose file
  was moved or deleted throws ENOENT, which the handler turns into a 500. The
  user sees a server error for what is really "that file is gone" — the same
  class of problem that produced the `keys.js` ENOENT bug.

- **Device rotate/revoke (`public/js/devices.js`) and skill toggles report
  failures through `appAlert()` only.** Not silent, but a modal for a failed
  toggle is heavier than the inline status line those cards already have.

## Settings that exist only as environment variables

These are documented in the README but have no UI, unlike the eight paths in
Settings → System:

| Variable | Why it is still env-only |
| --- | --- |
| `PORT` | Changing it from the page would drop the page. Needs a "restart on :NNNN" flow, not a text box. |
| `DOCA_DATA_DIR`, `DOCA_PREFS_FILE` | Moving these relocates the prefs file the UI writes to, so a bad value locks you out. Wants a migrate-and-verify step. |
| `DOCA_LEGACY_TRUST` | Security-relevant; deliberately not a checkbox. |
| `OPENCLAW_GATEWAY_URL` | Reasonable candidate for the Paths card treatment. |
| `DOCA_FONT` | Cosmetic; belongs with the theme controls if it is ever surfaced. |

`DOCA_STT_URL` / `DOCA_TTS_URL` are the inverse case: they override the Voice
card rather than defaulting it, which the card now states.
