---
name: play-and-cast
description: Play a video, music or a program on a screen, or cast it to a TV or speaker — by the quickest route that already works in this home (Home Assistant's media players, the device's own app, the hub). Use when the person asks to watch, listen, put something on the TV, stream or cast, especially from a call or the ambient screen.
---

# Playing and casting

The person says "put the match on the living-room TV" or "play my focus playlist here". There is never one way:
pick the **quickest route that already works in this home**, and when you do not know one yet, ask once, do it, and
keep how — so the next time is a recipe, not a round of thinking.

## 1. Look for what you already know

- `memory_search` for the device and the thing ("living room tv", "spotify", "cast") and the recipes the person has
  (`recipe list`). A recipe named for it (`play-on-living-room-tv`) is the answer: run it with the title as its value.
- If nothing is known, go on — and remember to keep what worked (step 4).

## 2. The routes, quickest first

1. **Home Assistant's media players** (when its MCP server is connected — `skills/smart-home`): `GetLiveContext`
   names the TVs, Chromecasts and speakers it can see. Pausing, resuming, the volume and the next track are its own
   tools (`HassMediaPause`, `HassMediaUnpause`, `HassMediaNext`, `HassSetVolume`). Starting a particular film or
   playlist needs a script the person exposed, or the device's app (route 2).
2. **The device's own app**, opened at the thing: a link the app understands opens it straight there — a YouTube or
   Spotify address, a `netflix.com/watch/…` link, a file in the shared home.
   - On a computer with doca-client: its `apps_open` tool with the address.
   - On the agents' computer or the person's browser extension: open it in the browser.
   - On the phone (DocaMobile) when it lends its apps: open the app and, to put it on a TV, press its **cast** button
     and choose the TV — the app's own way, so it keeps working when the person picks it up.
3. **From the hub**: play a file or a stream on the hub's own screen or speakers, or cast an address to a Chromecast
   on the network with a casting tool the hub has (`catt cast <url>` — propose installing it through System tools if
   it is missing; never with `shell` on your own).

If a route needs something the person has not set up (no Home Assistant, no paired phone), say which and offer the
next route rather than stopping.

## 3. In a call, stay with the person

When this was asked in a call or on the ambient screen, say one short sentence ("Putting it on the living-room TV")
and keep the call: the person may say "stop", "pause", "louder", "go back" at any moment, and each is one tool call on
the route you used. Do not start describing the film. When the person says nothing more, the call ends on its own and
the screen waits for its name — the video keeps playing.

## 4. The first time: ask, do, keep

When no route is known for this device and service, ask **once**, briefly: "Which TV is that — the one Home Assistant
calls media_player.living_room? And do you usually cast from the YouTube app?" Then do it. When it worked:

- `memory_write` the fact (`living-room tv: Chromecast, media_player.living_room; YouTube casts from the phone app`);
- `recipe save_last` with the title or address as a parameter, so "put X on the living-room TV" runs without thinking;
- say in a few words that next time it will be quicker.

Never buy, rent or sign in for the person: a paid title, a login or a "continue on the TV?" with a purchase behind it
is theirs to press (the computer and the browser extension refuse those buttons anyway).
