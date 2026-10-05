---
name: smart-home
description: Control the building — lights, climate, blinds, plugs, locks, sensors, scenes — through Home Assistant's MCP server (or MQTT where there is no Home Assistant). Use when the person asks to turn something on or off, set a temperature, check a sensor, or run a scene.
---

# The building, through Home Assistant

DOCA does not talk to bulbs and thermostats one brand at a time: Home Assistant already does, for thousands of brands,
and since 2025 it is an MCP server. Once it is connected, every device the owner exposes to Assist is a tool here.

## Connecting it (once, with the person)

1. In Home Assistant: Settings → Devices & services → Add integration → **Model Context Protocol Server**. Which
   entities it may touch is Home Assistant's own choice: Settings → Voice assistants → **Expose** — tell the person
   that is where to widen or narrow what you can do.
2. A token: their Home Assistant profile → Security → **Long-lived access tokens** → Create. They paste it; never ask
   for it in chat, never write it anywhere.
3. In DOCA: MCP tab → From the catalogue → **Home Assistant** (or propose it: `install_propose {kind: "mcp", id:
   "home-assistant"}`). It is added off, with `http://homeassistant.local:8123/api/mcp`; the person edits the address
   if theirs differs and puts the token after `Bearer ` in the Authorization header, then starts it (`mcp_connect`
   once they have).
4. Check: `mcp_status` lists its tools — `HassTurnOn`, `HassTurnOff`, `HassLightSet`, `HassClimateSetTemperature`,
   `GetLiveContext` (what every exposed entity is doing now) and the scripts they exposed.

## Using it

- **Read before you act.** `GetLiveContext` first when you are not sure of a name or a state; devices are named by
  area and name ("kitchen light"), as the person says them.
- **Do what was asked, then say it in a few words** — in assistant mode one sentence: "Done, the hall is at 21°."
- **Ask first** for anything that opens or unlocks (locks, garage doors, gates), disarms an alarm, or affects someone
  else's room — a voice in a room is not proof of who is speaking. Turning lights, plugs and media on or off does not
  need asking.
- **Several devices at once**: a scene or a script the person made is better than many calls; offer to save a
  sequence that worked as a recipe (`recipe save_last`) — "good night" then runs without thinking.
- **It is off or unreachable**: say so plainly (the address, the token, Home Assistant down), do not guess states.

## Without Home Assistant

- **MQTT** (Zigbee2MQTT, Tasmota, ESPHome, Shelly): with a broker on the network, `mosquitto_pub -h <broker> -t
  <topic> -m <payload>` through `shell` (System tools has `mosquitto-clients` on most Linux), reading the device's
  documented topic first. Propose installing Home Assistant when there are more than a few devices.
- **A device with its own HTTP API** (a Shelly, a Hue bridge): `http_fetch` on the person's own network, after reading
  its documentation with `research_docs`.
- Never scan the network for devices without the person asking.
