# Parity with Teams and its competitors

Asked 2026-10-12: "we need to have everything Teams or competitors offer. Not from the start but eventually." The
reason is the premise (CONSTITUTION §0): DOCA is a product for anyone, and a reason to keep another suite open is a
reason to leave. Each line below is a capability people expect from Microsoft Teams, Slack, Google Meet/Chat, Zoom
and Discord, with what DOCA has (2026-10-13, v3.58.0) and what is missing, in the order it would be built. Every item
still follows the constitution: consent, visibility that is mechanical, local first, the person's own models.

| # | Capability | Where DOCA is | Missing, in order |
|---|---|---|---|
| 1 | Direct and group messages, channels | Hive chat (3.16.0): DMs, groups, organisation channels, mentions, notifications per device, compliance export | threads inside a message; reactions; edit and delete with history; pinned messages; read receipts (opt-in) |
| 2 | Calls and video meetings | Meetings (3.17.0): voice, video, screen sharing, control with two consents, invites in each person's calendar, phone screen sharing (3.23.0) | an SFU for rooms over 6–16; TURN through the edge for calls across the internet; guests by link; raise hand; reactions in the call |
| 3 | Chat inside a meeting | the meeting room's chat (3.17.0) | its record kept with the meeting's notes (meeting-notes.md) |
| 4 | Meeting notes, transcript, recall | notes with consent, transcript, write-up and record (3.70.0) | **meeting-notes.md** — consent, own-microphone transcript, shorthand written up, live answers, record found again |
| 5 | Recording | not yet | a recording of what consenting people sent, kept with the record; the same consent as notes |
| 6 | Files shared in a conversation | attachments in chats; Files; Projects | a conversation's files tab; a file's versions; who opened it |
| 7 | Shared documents edited together | project pages (markdown, with a chat about the page) | live co-editing (two cursors) — a CRDT on the page, or the person's own Docs connector (P23) |
| 8 | Calendar and scheduling | each person's Google/Microsoft calendar (accounts/), meeting invites, reminders | finding a time for several people (free/busy), rooms |
| 9 | Presence and status | screens' heartbeats; who is in a meeting | a person's status (available, busy, away, in a meeting) shown in chat and the people list; quiet hours already exist per device |
| 10 | Apps and bots in a conversation | the agent in every chat (@orchestrator), MCP servers, connectors, skills | an app's card in a conversation (an approval, a form) — the switch question (3.57.0) is the first such card |
| 11 | Search across everything | header search in sections (3.58.0), Library by meaning, recall | messages and meetings as sections of the same search |
| 12 | Admin: people, levels, retention, export | users and levels, allotment, log retention, compliance export | retention per conversation; legal hold |
| 13 | Mobile and desktop apps | DocaMobile, DocaWear, DocaDesk, the panel on any browser | native call screens on phone and watch (meetings.md "Not yet") |
| 14 | Live captions and translation | the call's transcriber in five languages | captions in a meeting (from the notes' hearing, consent the same); translation by the person's model |
| 15 | Whiteboard | not yet | a canvas page in a meeting (the Projects canvas, shared) |

**Order of work:** 4 (notes) → 3 → 5 → 9 → 1's threads and reactions → 2's guests and TURN with the edge → 11 → 14 →
8's free/busy → 7 → 15 → 12 → 2's SFU. Each lands behind its own design note and in TODO.md before code (W5).
