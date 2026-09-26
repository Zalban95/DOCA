# Where DOCA keeps what — and what travels

DOCA's state lives in two places:

- **The prefs file** (`PREFS_FILE`, default `~/.dashboard-prefs.json`): one JSON
  object of settings.
- **The data folder** (`DOCA_DATA_DIR`, default `<DOCA_HOME>/.doca`): what DOCA
  knows and has done — conversations, memory, agents, users, devices, keys.

Every top-level entry of either is classified in `modules/state-map.js`:

| Class | Meaning |
|---|---|
| **travels** | Meaningful on another machine and safe to hand on: how this DOCA looks and behaves, what it knows, who its agents are. |
| **local** | Bound to this machine — paths, ports, binaries, spawnable commands — or a secret. A backup of *this* machine carries it; an export meant for another machine must not. |
| **mixed** | Both, key by key; the entry's note says which part is which. |

The rules that follow from it:

1. A new prefs key gets a line in `state-map.js` in the same change —
   `test/state-map.test.js` fails otherwise.
2. A secret never goes in a *travels* entry. Provider keys live in the data
   folder (`keys/`), not in `harness` settings, for that reason.
3. Anything that names a command this machine will run (`mcpServers`, the
   approval allowlist) is *local*, whatever else it holds.
4. A backup (`.dBac`) takes everything; a future export or template takes only
   what travels.
