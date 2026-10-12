# Casting, devices in groups, and controls anywhere

Asked 2026-10-12 (the owner, from the phone): a cast button on mobile; the cast view shaped like the device it lands
on, or only audio when that device has no screen; cast the phone's page but in desk mode, with a lock so it stays —
"cast a Live or the Workstream to a random monitor I select in the Wi-Fi and let it there"; cast in the Wi-Fi the phone
is on; pair devices in other networks the person has access to, kept when they leave; the phone as the interface
between the hub and a device it paired ("like the watch"); a Devices tab where everything is organised in groups;
every device's commands — real devices and virtual ones, panel actions included — selectable from the watch's settings
in a drop-down, and DocaWear holding several presets.

This document says how, built on what exists (hive.md's four questions; CONSTITUTION §0 versatility, P12 clients
extend the reach, P18 live everywhere, P21 show the work, S2 reach follows the level, V12 mechanical first — proposed).

## What exists

- **Nearby** (`modules/nearby`): Cast TVs and speakers (mDNS), UPnP/DLNA renderers (SSDP), Bonjour, Bluetooth, the LAN,
  Home Assistant's devices and the tailnet, merged one row per thing; a Cast row already says how to cast a page
  (`catt cast_site`, DashCast).
- **A page alone** (`/?view=<page>`): a page without the panel around it, servable on a wall screen; a screen record per
  browser (`modules/screens`), with its own settings layer — a desk and a phone already look different.
- **Commands** (`api-v1/commands.js`): the hub's own actions in one registry, run by a phone with `commands:run`.
- **The watch through the phone**: DocaMobile carries DocaWear's calls to the hub (the relay envelope) — the shape the
  phone-as-interface needs.

## 1. Cast (phase 1: the hub's network; phase 2: the phone's)

**The button.** On a phone, a ⎘ Cast button in the header (and in a page's own menu) lists what can show it:
- **Screens on the network the caster stands in**, from Nearby (Cast, DLNA renderers, smart TVs with a browser);
- **DOCA's own screens** — any signed-in browser (a desk, a wall tablet), already reachable by `POST /api/screens/:id/show`.

**Shaped for where it lands, not where it was pressed.** The cast opens `/?view=<page>` on the target in the target's
own layer — desk density and layout for a TV or a monitor (wide, the panel's desk skin), never the phone's. A target
with no screen (a speaker) is offered **audio only**: what the page speaks or plays (a call's voice, the agent reading
the answer, the ambient music) — the page itself is not sent.

**It stays.** A cast is a *standing screen*: the target holds the page until someone changes it; the phone may lock,
leave or switch off. The phone's 🔒 Keep marks it so in the screen record (`kept: true`): DOCA does not take it back when
the phone goes, and the Devices tab lists it as showing <page> until a person stops it.

**How a page reaches a screen that cannot sign in.** A Chromecast or a TV browser has no keyboard to sign in with. The
cast hands it a **view link**: a one-page, read-only, short-lived token bound to that screen record — it opens exactly
the page cast (Live, the Workstream, Ambient…), shows what the caster's level shows, acts on nothing, and is revoked by
Stop or by revoking the screen like any device. **This is a new way in** (an auth change, CONSTITUTION S11): it waits
for the owner's yes.

**The network.** Phase 1 casts from the hub: the hub sends the page to a Cast or DLNA target on its own network
(DashCast for a page, the default receiver for audio), so it works today for screens beside the hub. A cast target
then loads the page from the hub's LAN address — which needs `network.listen` `lan` for the view link only, never the
machine's rights (the gate already refuses those from outside loopback and the tailnet). Phase 2 casts from the phone,
on whatever Wi-Fi it is on: DocaMobile's Google Cast sender (the DashCast receiver for a page, the default receiver
for audio), the page fetched through the phone when the target cannot reach the hub.

## 2. Networks, and the phone as the interface (phase 3)

**Networks are remembered.** A device paired through a phone records the network it was found on (its name and the
router's address); the Devices tab groups by network, and a device on a network nobody is on now is shown **away**,
never forgotten. Back on that Wi-Fi, it is there again.

**The phone carries it.** A device the hub cannot reach (a Bluetooth speaker, a Cast target on another Wi-Fi) is paired
through the phone, which then acts for it the way it acts for the watch: the hub sends a command for that device to the
phone, the phone performs it on its network or its Bluetooth, and says what happened. Away from it, the command waits
or is refused with where the device is.

## 3. Devices in groups, and controls anywhere (phase 1)

**One Devices tab** (Machines → Devices, the existing list grown): every device — paired clients, browsers, Nearby
finds the person kept, devices a phone carries, Home Assistant's — in groups a person makes (a room, a desk, "living
room TV corner"), dragged or chosen, per person (their own grouping, S13).

**A device has controls**, real or virtual:
- a real device's own (a Cast target: play, pause, volume, stop the cast; a phone's lent families; HA's entities);
- **virtual controls**: anything the panel can do as one step — show a page on a screen, start a Live call, run a
  recipe, a scene, a hub command, put the Workstream on the living-room TV. A virtual device is a named set of them.

**The watch's controls are chosen, not hard-coded.** Settings → a watch's page → Controls: drop-downs listing every
control of every device the person may use (their level decides — S2), arranged into **presets** (Morning, Desk, Living
room…); DocaWear shows the active preset's controls and switches presets with a swipe. A control runs as its person,
under their approvals; one that changes the machine asks as it does today.

## Phases

1. **Hub**: Devices tab with groups; controls catalogue (real and virtual); cast from the hub to its network (Nearby
   targets, desk-shaped `/?view`), audio-only for speakers, Keep; watch presets as the hub's data (`/api/v1` gains the
   presets read and a control's run — **a change to /api/v1, the owner's yes first**, W3).
2. **DocaMobile**: the Cast button and Google Cast sender for the phone's own Wi-Fi.
3. **Networks and the phone as interface**: remembered networks, devices carried by the phone.
4. **DocaWear**: presets on the wrist.

## The owner's answers (2026-10-12)

- **The view link — yes**, and wider: read-only, for any page, and for live views too — a VM's console or an agents'
  computer working (view-only, never driven), and the panel's preview popups (a project being tested). Still one
  target per link, short-lived, bound to its screen record, revoked by Stop or by revoking the screen, acting on nothing.
- **`/api/v1` additions — yes** (the controls catalogue, presets, running a control, a phone carrying a device); the
  work is organised as the phases above.
- **How a cast reaches a TV that is not a DOCA screen** (asked once the limit was found: the hub answers only on the
  tailnet and this machine, with a self-signed certificate a Chromecast refuses): **DOCA screens first** — any browser
  signed in, or made one by opening a view link — and then **the page served through the phone**, "kind of like the
  watch": DocaMobile runs a small server on the Wi-Fi it is on and carries the view link's page from the hub over its
  own tailnet connection; no Tailscale on the TV, nothing of the hub opened to the LAN. Such a cast lives through the
  phone: it ends when the phone leaves that Wi-Fi, which the phone says (a DOCA screen keeps its page by itself).
