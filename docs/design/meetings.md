# Meetings: people calling each other

Asked 2026-10-09: *"Screen sharing, and even take control, with the same permission type. Meetings set up in actual
calendars; the calendars can be provider-agnostic, so if I use Google and my colleague uses Microsoft they just have to
go in with the call ID and/or link and be notified as they would."* Built in the branch `meetings` (`modules/meetings`,
`public/js/meet/`, `public/js/meetings.js`; licence code `meetings`).

## The experience

- **Call someone now.** Controls → Meetings, tick a colleague, 📞 Call now — or the hive chat's call button
  (`meetingStart({space, people})`). The room opens over the panel; the colleague's open pages ring ("Alice is
  calling — Join / Decline") and their devices get an urgent notice with the link.
- **Schedule.** Pick a time on your own clock, the people (of the hive, or mail addresses outside it), a note. Each
  person gets it **in their own calendar**: their Google or Microsoft account connected in Meetings → the event is made
  there as theirs, the room's link as its place; otherwise a standard iCalendar invitation by mail (when the hive's
  mail channel is set up); otherwise a notice on their pages with "Add to calendar" (the same `.ics`). Moving it
  updates the same events (iCalendar SEQUENCE + 1); cancelling removes them (METHOD:CANCEL). Five minutes before,
  everyone is told on their devices and pages, as a calendar would.
- **The agent proposes.** "Set up a call with Anna on Thursday at three" → the `meeting` tool makes a *proposed*
  meeting; nobody is invited until the person presses Confirm in Meetings (CONSTITUTION S1: the agent's own initiative
  is a proposal).
- **Join** with the link `https://<hub>/meet/<id>` or the id itself (`m` + 12 hex digits, the "call id") — any signed-in
  person of the hive who is in that meeting. A device lists its person's meetings (`GET /api/v1/meetings`) and opens
  the link in its web view.
- **In the room**: cameras as tiles, a shared screen large on the stage, chat, mic/camera, Leave (or End for all, the
  organizer). `–` folds the room into a corner tile so a person can share and keep working in the panel.

## Sharing and taking control — consent first

- Sharing is started only by the sharer, with the browser's own picker (`getDisplayMedia`; WebView2 in DocaDesk has
  it too). While it lasts a **red bar** says "You are sharing your screen" with Stop.
- **Control** is of a screen being shared, and needs **two consents from the sharer each time**: (1) "Let *Bob* control"
  naming the machine that screen is, (2) a confirmation that says what it means ("Bob will move the pointer and type on
  Alice's desk until you stop it — Stop, or Esc three times"). A viewer may ask first ("Ask to control"), which only
  asks.
- Input never comes from a plain browser share: it goes **through a DOCA client on the sharer's own machine** that
  lends the `input` family (PROTOCOL §22.1 — DocaDesk's `input_click/move/type/keys` today; DocaMobile's
  `input_tap`). The controller's pointer and keys travel over `/ws/meet/<id>` as fractions of the picture; the hub
  scales them to the share's pixels and calls that device's own tools. Everyone sees an amber label with the
  controller's name where they point. While a person controls a machine, the agent's own `input_*` on it wait.
- **Ends at once**: the sharer's Stop control or Stop sharing, Esc ×3 on their meeting page, the controller letting
  go, either leaving, the share stopping, the meeting ending, an unconfirmed offer after two minutes.
- **Who may** (the same permission type as devices — CONSTITUTION S2, `auth/reach.js`): the controller's level must
  reach devices (`own-devices` or `anything`; a level that only creates reaches none), both in the same organisation,
  the machine the sharer's own paired device with `input` granted and not revoked. Joining a meeting needs the `chat`
  right and being one of its people; an admin does not see or join other people's meetings.
- **Written down**: every share start/stop and every control step (asked, offered, granted, refused, ended — with
  how many characters were typed, never which) in the audit (`meeting.*`) and the hub's activity (Chronicle, source
  `hub`).

## How it is built

| Part | Where | Notes |
|---|---|---|
| Meetings and their people | `meetings/store.js`, schema step 15 (`meetings`, `meeting_people`) | step 14 left to the hive chat |
| Who may | `meetings/access.js` | members only; `controlRefusal` |
| The room | `meetings/rooms.js` | in memory; a peer is a page's live stream; `meeting` topic on the live feed |
| Media | `public/js/meet/mesh.js` | WebRTC mesh, perfect negotiation; the interface an SFU client would keep |
| Control | `meetings/control.js`, `socket.js`, `public/js/meet/share.js`, `hand.js` | two consents, device tools |
| Calendars | `meetings/calendars.js` (Google Calendar API, Microsoft Graph), `ics.js`, `invite-mail.js`, `invite.js` | the owner's OAuth app, each person's own account, scope events only; tokens in `keys/calendars.json` |
| Reminders | `meetings/remind.js` | every 30 s, `meetings.remindMin` |
| For other parts | `meetings/hooks.js`; `meetingStart`, `screenShareStart`, `meetingOpen` in the page | the hive chat hooks here |

**Signalling** rides what already exists: a page's messages go up as POSTs (`/api/meetings/:id/signal`) and down on
the live feed, addressed to one page. **Media is peer to peer** (a mesh): every page sends to every other, so a room is
capped at `meetings.maxPeople` (6 by default, 16 at most). Larger rooms need a selective forwarding unit: the pages
already talk through `meetMesh`'s interface (`add/remove/signal/setTracks`), so an SFU client replaces that one file
and becomes one more peer in `rooms.js`.

**Networks.** With no STUN or TURN the pages offer their host candidates, which is what works on the tailnet and the
LAN — the hive's networks. Calls across the internet need a TURN relay; it is meant to come through the coming edge
(our own relay, no third party in the media path). `meetings.iceUrls` takes STUN/TURN addresses meanwhile (without a
password; a TURN credential will be minted by the edge, short-lived, never kept in prefs).

**Time zones.** Times are stored in UTC; the form sends the browser's zone; invitations are in UTC (unambiguous in
every calendar) and their words are on each recipient's own clock (`timezones.js`, from their screens' heartbeats).

## Not yet (TODO.md, "Meetings")

- The agent as a voice participant: one more peer the hub hosts (`hooks.js` says how; realtime/pipeline.js already
  speaks the audio wire).
- Native call screens in DocaMobile and DocaWear, calling from a watch, a phone's own screen shared (MediaProjection).
- DocaDesk: a banner on the desktop while someone controls it, and Esc ×3 caught by the app itself (today Esc ×3 is
  caught by the sharer's meeting page only).
- doca-client's `input` family (xdotool / SendKeys / CGEvent) so Linux, macOS and Windows machines without DocaDesk
  can be controlled; the browser extension controlling a shared *tab* (its tools address elements, not pixels).
- Guests from outside the hive (a one-time link through the edge); RSVP replies from calendars back into the meeting.
