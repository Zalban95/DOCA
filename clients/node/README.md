# doca-client

Make this machine part of the hive: Linux, macOS or Windows, Node 22, no dependency.

```bash
node doca-client.js find                                           # the hubs on this machine's tailnet, by name
node doca-client.js pair https://<hub>:4242 641-598 --name desk   # the code: hub → Field → API keys → Pair a device, Role "phone"
node doca-client.js pair 'doca://pair?code=641598&host=<hub>:4242' # or the pairing link (its QR) in one step
node doca-client.js run                                            # asks once per family; --grant files,shell to skip asking
```

A machine paired by someone who may not approve it at once waits for approval: `pair` and `run` say who was asked, and
`run` waits, lending nothing, until a person allows it (one tap on their phone or in the panel) — refused, it stops as
if revoked. Then accept its offer once in the hub (MCP tab). From then on the hub's agents can use this machine's **files**
(`files_list/read/write/mkdir/move/copy/delete`, inside your home folder only), **shell** (`shell_run`), **screen**
(`screen_capture`), **processes** (`processes_list`, `processes_stop`), **apps** (`apps_open`: a web address, or a file
in your home folder) and **device** (`device_info`, `device_notify`, `device_clipboard_read/_write`) — only what you
granted, and the hub's Files tab browses it. Keep the other files of this folder beside `doca-client.js`.

Each family uses what the OS already has. macOS and Windows need nothing more; on Linux the screen wants `grim`
(Wayland) or ImageMagick's `import` / `scrot` / `gnome-screenshot` (X11), the clipboard `wl-clipboard` or `xclip`,
notifications `notify-send` — a missing one is named in the answer, never guessed around. Revoking a family in the hub (its row in API Keys) stops it
at once; `run` again re-offers after a restart. Revoking the whole machine ends its lending: the hub removes the
server it hosted, and the client stops serving and stays stopped (`run` says so) until you pair it again. A hub's self-signed certificate is pinned at pairing and is the
only one trusted afterwards; the listener binds to your tailnet address and answers only with its secret.

**Secrets, used and never read.** With `device` lent, the hub can hand this machine a password or a key for one
use — you are asked in DOCA every time — sealed with a key only this machine holds (taken from the hub at `run`). It
is typed into what has focus (`xdotool`, `wtype` or `ydotool` on Linux; System Events on macOS; SendKeys on Windows) or
put on the clipboard for a set number of pastes or seconds (`xclip` counts pastes on X11, `wl-copy` serves one on
Wayland; macOS and Windows clear it after the time, Windows keeping it out of clipboard history), then forgotten.
While it is on the clipboard this machine refuses the hub's clipboard reads and command lines. A clipboard manager
of your own may still keep a copy: prefer typing, or turn the manager's history off for passwords.

On a server, a Pi or a desktop nobody sits at: run it once by hand (so you decide what it lends), then
`doca-client enable` starts `run` by itself — a systemd user unit on Linux (`sudo loginctl enable-linger <you>` to
run with nobody logged in), a launchd agent on macOS, a Task Scheduler entry at sign-in on Windows. Without a terminal
it asks nothing: what you have not decided stays not lent. `disable` and `boot-status` undo and check it.

`update` brings it to the copy its hub ships (each file checked against the hub's sha256 before it replaces anything;
the old copy kept in the config folder). `status` shows what it lends; `forget` removes its config (revoke the device
in the hub too).

**A home node.** On a machine that stays on in the house (a mini PC, a Pi, a NAS — not a laptop that sleeps),
`doca-client home setup` asks Home Assistant's address and a long-lived token (HA: your profile → Security →
Long-lived access tokens), checks them, and keeps them here in the config (0600) — the hub never receives the token.
`run` then asks whether to lend **home** (`home_states`, `home_call`, `home_camera`) and lends over a socket it opens to
the hub, so nothing in the house has to be reachable; accept its offer once in the hub's MCP tab and the hub's Home page
shows the house. It keeps HA's connection on the home network, pushes each change up, and reconnects to both with a
growing wait. `home` shows what is kept; `home forget` removes the token. `run --socket` lends any family that way.
