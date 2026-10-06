# The ambient screen

Asked 2026-10-06: "on some devices users might want the behaviour of a Google Nest: holding the call button starts a
call with the dots … as a rotating galaxy on the bottom fifth of the page, leaving the background to the usual info …
when called the background becomes dimmer and the dots go up … if nothing is requested the dots go back down."

## What it is (hub, 2.237.0)

- **A page of the panel**: Controls → Ambient, best served alone at `/?view=ambient` (a tablet on a wall, an old phone
  on a dock, a second monitor). `public/js/ambient.js`, `public/css/ambient.css`; the server's half is
  `modules/ambient` (`GET /api/ambient?place=&units=`, right `read`).
- **Behind the galaxy**: the time; the weather now and five days (`ambient/weather.js`, Open-Meteo — no key, a place
  geocoded once, kept 15 minutes); today's plan from Google Calendar or Microsoft 365 when connected, shown to a host
  or to everyone once the owner opened the connector (`ambient/calendar.js`, the connector tool's own rule); notices
  that are this person's (questions the agents wait on, an admin's proposals, missions working and just finished);
  quick buttons (`ambient.buttons`, `{label, say}` — a tap starts a call with that sentence); the device's most used
  apps where the phone app lends them (below).
- **The galaxy** (`face/galaxy.js`): the face's points as a two-armed disc seen ten degrees above its plane, dense at
  the heart, turning slowly. `faceAmbientForm` holds both places of every point — the galaxy and the call's
  polyhedron — and face.js eases `rise` (0 … 1) so the journey is a spring with a little swirl.
- **A call**: hold the galaxy (~0.45 s), tap ◉, a quick button, or say the wake word. It is assistant mode's call
  (`chatToggleCall({assistant: true})`): spoken answers, the face driven by the voice, everything the call already
  does (talking over it, act-don't-answer). The info dims; after `call.assistantIdleSec` without words the call ends,
  the points go back down and the screen listens for its name again.
- **The microphone**: while resting, only for the wake word (experiment `wakeWord`, and `ambient.listen`, default
  on); a call or a recording takes it (`wakeWordPause`) and gives it back when done.
- **Settings** are the screen's own (`ambient` in settings-schema.js, home device, on screen): `place`, `units`,
  `listen`, `clock24`, `buttons`. ✎ on the page edits them; ✨ on that form lets the agent fill a draft.

## Playing and casting

`skills/play-and-cast`: the quickest route that already works — Home Assistant's media players, the device's own app
opened at a link (doca-client's `apps_open`, the browser, the phone), the app's own cast button, or the hub casting
an address. Known routes are memory and recipes; the first time the agent asks once, does it, and keeps a recipe. In a
call it says one sentence and stays: "pause", "louder", "stop" are one tool call each.

## What the phone adds (DocaMobile, next)

1. **`window.DocaDevice`** in the WebView (a `@JavascriptInterface`, only on the hub's own origin):
   - `apps(limit)` → JSON `[{label, package, icon}]`, the most used launchable apps (UsageStatsManager with the
     person's "usage access", else the launcher's list), `icon` a small PNG data URL;
   - `open(package)` → launches it. The ambient page draws them under the quick buttons when the bridge exists.
2. **Ambient when docked**: a setting to open `/?view=ambient` full screen, kept awake, when the phone is charging
   or docked (a "daydream"/screen saver entry, or the app's own activity).
3. **The device as an MCP family over the socket transport** (`wss://<hub>/api/v1/mcp/host`, as the browser
   extension does — PROTOCOL.md §22.2), asked once per family like doca-client: `apps_open {package | url}`,
   `screen_read` (the accessibility tree as numbered elements, never a password field's value), `screen_tap`,
   `screen_type`, `media` (play, pause, next, volume through the media session), `cast {route}` (MediaRouter). The
   computer's rules hold: no password or card field typed, a pay/submit/sign-in control needs `confirm: true`, which a
   person answers. With it the agent opens YouTube at the video, presses cast, picks the TV — while the call stays on
   the screen that asked.
