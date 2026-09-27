# Devices as hands — the harness works on the clients as it does on the host

**Status: approved by Al 2026-09-27.** Step 2 (the DOCA side) in progress.

Decided in discussion: the harness's reach is near-absolute on the host, and a
paired device should be an **extension of that reach**, not a remote control with
a few tools. DocaDesk (Windows now, Linux next) gets the same families of tools
the host has; the apps get what their operating system allows. Consent is given
**once per device and per family**, then nothing is asked. What makes that safe
is not a question before each action but the same things that make the host
safe: checkpoints and snapshots to go back, the audit log, the airlock for
outside text, and a person who can revoke a family at any time.

## 1. What each device offers

Tool families, the same names on every machine so an agent learns them once:

| Family | Host (today) | DocaDesk — Windows / Linux | Phone (DocaMobile) | Watch (DocaWear) |
|---|---|---|---|---|
| **files** — list, read, write, move, delete | yes | yes (everywhere the user can) | user storage, after the one-time "all files" permission | minimal |
| **shell** — commands, background jobs | yes | yes (PowerShell / sh) | the app's own sandbox only (no root) | no |
| **processes** — list, start, stop | yes | yes | its own | no |
| **screen** — capture a window or the screen | via DocaDesk | yes (Windows Graphics Capture; Linux: the desktop portal) | yes (MediaProjection: consent once, the session held open in the background — see below) | no |
| **input** — click, type, keys | no | yes | only through an Accessibility service: a separate, clearly labelled switch (Play restricts it; fine for our own builds) | no |
| **apps** — open an app, a link, a file | yes | yes | yes (intents) | limited |
| **device** — notifications, prompts, camera, location, sensors | — | notifications, prompts | yes | notifications, sensors |
| **elevated** — admin actions, installs | yes | yes, through the OS prompt (UAC / polkit) each time | no | no |
| **mcp** — the device's own MCP servers, forwarded | — | yes (today) | — | — |

## 2. Consent: once per device and per family

- On first use of a family the **device** asks its person, in its own UI, once:
  *"Let DOCA's agents use files on this machine?"* — remembered on the device,
  revocable there and from DOCA (Settings → This device).
- The **operating system's** own prompts are never bypassed: UAC or polkit for an
  elevated action, Android's runtime permissions, MediaProjection per session.
- DOCA knows what each device has granted (the device reports it, like its caps),
  and offers the harness only those families — a tool the device would refuse is
  not shown as available.
- The harness's approval mode still applies on top (Auto / Manual / Unattended),
  exactly as for host tools; in Auto, a granted family runs without asking.

### The phone's screen, held open

Android asks for screen capture per *session*, not per frame. The app starts one
session after the person's consent, inside a foreground service of type
`mediaProjection` (Android 14+), and keeps it open: a frame is taken whenever the
harness asks, with no new prompt. It asks again only when the session has really
ended — the person tapped stop on the system's screen-sharing chip (Android shows
it while the session is open, and that cannot be hidden), the app was killed, or
the phone restarted. The same foreground service holds the connection to DOCA, so
"disconnected" is a state the device reports, not a guess.

## 3. Trust: your devices are not "outside"

Today every MCP result counts as outside text — labelled, and the first action
after it asks again (2.103.0). For a device **you paired, running DocaDesk or the
apps**, that is wrong: its answers are your machine talking. So tools get a
**trust origin**:

- **own device** — a paired device's own families (files, shell, screen…):
  trusted like the host. Not framed, no re-check.
- **third party** — any other MCP server (including ones a device forwards) and
  web content: outside, as now — labelled, screened by the guards when an
  airlock agent reads them, and the re-check net.

## 4. Going back: checkpoints and snapshots

- **Folder checkpoints everywhere.** The shadow-git checkpoints of 2.77.0 work
  on any folder without admin. The client takes one before the agent changes a
  folder it has not checkpointed in this turn; DOCA lists and restores them
  like a project's.
- **System snapshots where the machine can**, before the actions marked
  dangerous (installs, system settings, deletions outside a project, elevated
  commands): btrfs / ZFS / LVM snapshots on Linux; a Windows restore point
  (needs admin; Windows limits them to about one a day, so it is best-effort and
  says when it was skipped). On the host the same rule, where the disk supports it.
- Every action is in the audit log with the person it was for and the device it
  ran on.

## 5. The device's own page: `https://<host>:4242/d/<device-id>/`

The apps and DocaDesk open **their own page**, the panel personalised for the
device that opened it:

- **Settings → This device**: what it has granted, its local MCP servers, its
  folders, its checkpoints — the "local" section — and its **actions**:
  - **Refresh** — the device reports its caps, grants and state again;
  - **Reconnect** — drop and reopen its push stream;
  - **Ask again** — re-request a family's permission (or the screen session);
  - **Disconnect** — close its sessions and stop its services until it is
    opened again, without unpairing;
  - **Revoke a family** — take one permission back from DOCA's side;
  - **Unpair** — forget the device (what Settings → Devices does today).
  The same actions on every device's row in Settings → Devices.
- **Files and Projects**: a **machine selector** — *host · portal · phone…* — the
  shared tree (2.101.0) showing that machine's folders through its files family;
  a project can live on a client, with search, git and run executed there.
- The rest of the panel as usual.

**The path is a view, never a key.** A device id is not a secret (it appears in
lists and logs). Access is decided as now — the device's session (its token on
the first load, then DOCA's cookie; auth §6) and its person's rights. `/d/<id>/`
is served only when the signed-in session belongs to that device or to a person
who owns it; any other request gets the ordinary panel or a refusal.

## 6. Order of work

1. **This document**, approved.
2. **DOCA, buildable on the host alone:** the `/d/<id>/` view and Settings → This
   device; the machine selector in Files and Projects, speaking a device's files
   family (with a stand-in device in the tests); trust origins; checkpoints of
   client folders recorded and restorable from the panel; the families in the
   protocol (`PROTOCOL.md`) and the device caps.
3. **DocaDesk:** the shared `DocaDesk.Host` library (credentials and capture behind
   a per-platform switch; the WinUI app unchanged), then the families behind the
   first-time consent — Windows first, the Linux client headless on the same core.
   After the D-4 review. **On portal.**
4. **Apps:** files, prompts and sensors first; screen; the Accessibility-based
   input as its own switch. **On portal, with the devices.**
