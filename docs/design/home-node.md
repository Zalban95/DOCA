# The home node

*2026-10-09. Asked by the owner: "We have to understand how to manage home automation given that the server sometimes
could be remote. Maybe home automation is only enabled through clients in households that keep a node of the hive
permanently or almost on."*

## The problem

Until now the hub talked to Home Assistant itself (`modules/home`, TODO H10.10): one WebSocket, signed in with the key
for services `home-assistant`. That needs two things that hold only when the hub lives in the house:

1. **HA's address must be reachable from the hub.** HA sits on a private LAN (`homeassistant.local:8123`). A hive
   hosted on a provider's server (`DOCA_PROFILE=hosted`, deploy/) has no route to it, and opening one — a port
   forward, HA Cloud, a VPN from the server into every customer's house — is the wrong way round.
2. **The household's long-lived token must live on the hub.** That token opens the house: locks, alarms, cameras,
   every integration HA has. On the household's own machine it is the household's; on a server someone else runs it
   is a key to a stranger's front door kept in a data centre.

## The answer: a node of the hive in the house

A **home node** is a paired device that is (almost) always on in the household — doca-client on a mini PC, a Raspberry
Pi or a NAS today; DocaDesk, or a phone or tablet while it charges, later. It lends one more family, `home`:

- **The token stays home.** `doca-client home setup` asks HA's address and a long-lived token *on that machine* and
  keeps them in the client's own config (mode 0600, beside its device token). The hub never receives it: not in a
  request, not in its prefs, not in its keys folder. `test/home-node.test.js` searches the hub's whole data folder for
  it.
- **Outbound only.** The node opens a socket *to* the hub (`/api/v1/mcp/host`, PROTOCOL §22.2) and is an MCP server
  on it. Nothing in the house listens for the hub; no port is forwarded; no tailnet is needed (though one works). A
  hub on a provider's server and a hub in the cupboard look the same to the node.
- **The node keeps HA's WebSocket on the home network** and pushes each change up the socket as a notification
  (`notifications/doca/home`), so the page stays live without the hub polling across the internet.
- **One list, enforced twice.** The tile shape and the short list of allowed services live once in
  `clients/node/home-shared.js`, which the hub reads and the client ships. The hub checks who may act and on what
  (allot `home`, a script an admin's, the password for unlock and disarm); the node checks the list again before HA
  hears anything, so a hub that is compromised — or a token that is misused against the node directly — still cannot
  ask the house to `homeassistant.restart`, run an integration's service, or carry data the list does not name.
- **Privacy.** What leaves the house is what the Home page draws: entity ids, names, states and a short list of
  attributes per tile (`ATTRS`) — never `entity_picture` or `access_token`, which carry HA tokens — and a camera's
  still only when a page or the agent asks for it. HA's history, logbook, automations, users and configuration stay
  in the house.

### What the hub does with nodes

`modules/home` is now a set of sources behind one page:

| source | file | what it is |
|---|---|---|
| `direct` (home id `hub`) | `direct.js` | the hub's own link, as before: for a hub on the household's network |
| `node` (home id: the node's name as a slug) | `nodes.js` | each paired device that grants `home`, whose server a person accepted |

`home.source` (Settings; the owner's, never proposable) chooses: **`auto`** (default) uses the nodes when there is
one — and on a hosted hive never the hub's own link, since it cannot reach a home — else the hub's key as before, so
nothing changes for an install already using it; `node`, `direct`, `both` as they say. Direct is preferred only when
the owner chooses it.

Everything else is unchanged: the page, the live topic `home` (each change now names its `home`), allot `home`, the
password for unlock and disarm, tiles, cameras. A level's `home` list may name an entity in every home (`light.*`) or
in one (`sea-house/light.*`); a grant `use:home:<home>/<entity>` adds one.

**Several households.** A family with two houses, or a customer with sites, pairs one node per place. Each is a home
with a name; the Home page lists them in a switcher (the choice kept per browser), and the agent sees each node's tools
under its own server.

**When a node is off.** The hub keeps what each node last said (memory and the store `home-nodes`, so a restart still
shows it). The page draws it greyed under a line saying the node is away and when it was last seen; every action is
refused (409 `node_away`) with that sentence. The node redials with backoff (1 s doubling to a minute) and keeps
trying HA the same way, so a router reboot or an HA update heals by itself. A laptop that sleeps is a poor node: the
home goes dark with its lid — the pairing card and the setup text say so.

**The agent.** The node's tools reach the agent as any device's do (`mcp__<node>__home_states|home_call|home_camera`),
under the person's reach and approvals — but the hub answers them as the page would: `home_states` narrowed to what
the person's level has, `home_call` through the same checks, a camera only when allotted. An unlock or a disarm
through `home_call` is a forced ask (`harness/forced-asks.js`): a person's yes every time, in every mode, never
"always" — the page asks for the password for the same calls.

## Why not …

- **…keep the token on the hub, encrypted?** It still has to be decrypted on the hub to be used, and the hub still
  has to reach the house.
- **…HA's own cloud (Nabu Casa) as the address?** It works for one household that pays for it, and still puts the
  token on the hub. A node needs nothing but a machine that is on.
- **…a new scope for the node?** None is needed: a lent family rides `mcp:self` like `files` or `screen`, consented to
  once per family on the node, revocable per family from the hub (`device.control revoke home`). A new scope or caps
  field would be an ask-first change (CONSTITUTION S11) and buys nothing here.
- **…let the hub dial the node?** That is the listener doca-client already has, and it needs the node to be
  reachable — exactly what a household behind NAT is not.

## What DocaDesk and DocaMobile would need to be nodes (not built)

Both already speak `/api/v1` and pair with `mcp:self`. To be a home node each needs:

1. **The socket transport** (§22.2) if it does not dial out already: DocaDesk hosts an HTTP MCP server on the
   tailnet today; it would open `wss://<hub>/api/v1/mcp/host` instead (or as well), with its device token.
2. **A place for HA's address and token that only the app reads**: Windows DPAPI for DocaDesk, Android Keystore-wrapped
   preferences for DocaMobile — never the hub.
3. **An HA WebSocket client** on the home network, the protocol in `modules/home/link.js` / `clients/node/home.js`
   (auth, `get_states`, `get_config`, the three registries, `subscribe_events`, `call_service`), reconnecting with
   backoff.
4. **The three tools and the push**, exactly as PROTOCOL §22.4 — the tile and the ALLOW list ported from
   `clients/node/home-shared.js` (or read from `docs/api/fixtures/families.json` for the names) and checked there.
5. **Staying on.** DocaDesk: start at sign-in and not sleep (a desk that sleeps is a laptop). DocaMobile: a foreground
   service while charging or docked, which it already has for the ambient screen saver — a node only while it holds
   it, the page saying "away" otherwise.
6. **The grant** `home` asked once in the app, reported in `PUT /devices/self/grants`, honoured on `revoke`/`restore`.

## Trying it

1. On a machine in the house that stays on, with Node 22: copy `clients/node` from the hub (or `doca-client update`
   once paired).
2. In the hub: Field → API keys → Pair a device, Role **phone**. On the machine: `node doca-client.js pair <link>`.
3. `node doca-client.js home setup` — HA's address (`http://homeassistant.local:8123`) and a long-lived token (HA:
   your profile → Security → Long-lived access tokens). It checks them against HA and keeps them there.
4. `node doca-client.js run` — say yes to lending `home` (or `--grant home`). In the hub's MCP tab, accept its offer
   once.
5. Controls → Home shows the house. `doca-client enable` starts it at boot.
