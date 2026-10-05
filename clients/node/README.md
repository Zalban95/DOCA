# doca-client

Make this machine part of the hive: Linux, macOS or Windows, Node 22, no dependency.

```bash
node doca-client.js pair https://<hub>:4242 641-598 --name desk   # the code: hub → Settings → API Keys → Pair a device
node doca-client.js run                                            # asks once per family; --grant files,shell to skip asking
```

Then accept its offer once in the hub (MCP tab). From then on the hub's agents can use this machine's **files**
(`files_list/read/write/mkdir/move/copy/delete`, inside your home folder only) and **shell** (`shell_run`) — only
what you granted, and the hub's Files tab browses it. Revoking a family in the hub (its row in API Keys) stops it
at once; `run` again re-offers after a restart. A hub's self-signed certificate is pinned at pairing and is the
only one trusted afterwards; the listener binds to your tailnet address and answers only with its secret.

`status` shows what it lends; `forget` removes its config (revoke the device in the hub too).
