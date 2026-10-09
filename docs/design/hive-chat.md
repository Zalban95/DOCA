# Hive chat — the people of a hive talking to each other

Asked 2026-10-09: "A chat for all the users, kind of like Teams but it has to actually work — all in the DB if
feasible. It can even be the same chat we use for the Orchestrator, but everyone sees their own Orchestrator and their
colleagues. Full chat. An organisation tree in the info of the user. Same permission type." Calls, screen sharing and
meetings are a separate piece of work; this leaves their buttons and one hook.

## What it is

- **Spaces**: a direct message between two people (one per pair), a group (named or not), and channels — an
  organisation's (everyone) or a team's (a leader and everyone below them in the tree).
- **Messages**: markdown, replies (a reply names the message it answers; a message's replies are its thread), mentions
  (`@Ada` by first name, whole name or email's local part), reactions, pins, edits, deletes as tombstones (the row keeps
  its place and its replies, its words and files go), files from the attachments store, read positions (one number per
  person per space: messages are numbered within their space), typing and read receipts (never stored).
- **Search**: the words of the person's own spaces (`LOWER(body) LIKE ?`, wildcards escaped — the same SQL on SQLite
  and PostgreSQL; FTS would be a per-engine second path for a hive that has not asked for one).
- **Retention**: `people.retainDays` (0 keeps everything), the admin's — never proposable. Pruned at start and daily,
  with an activity line.

## Where it lives

All in the database (schema step 14, feature `hive-chat`, both engines, every row `tenant_id`):

| Table | Holds |
|---|---|
| `people_spaces` | id, kind (`dm`, `group`, `channel`), name, topic, org, audience (`org` or `team:<leader>`), `dm_key` (the pair, unique), last number and time, archived |
| `people_members` | who is in a space, their role (`owner`, `member`), how far they read (`read_seq`), muted, and `agent_session` |
| `people_messages` | the message, its number in the space, author, `agent` when it is their agent's answer, reply, mentions, files, edited, deleted |
| `people_reactions` | an emoji per person per message |
| `people_pins` | pinned messages per space |

The organisation tree is three fields of the account record — `managerId`, `team`, `title` — kept in `users.data` (and
in the JSON accounts backend alike), so it needed no schema step and is core: a hive without the hive chat still has
its tree (`modules/org`).

## Who may do what — the same permission type

- **Rights at the gate** (`auth/rights.js`): reading `/api/people*` is `read`, writing `chat`, the export `org`; the
  organisation tree reads with `read`, and placing someone needs `users`, or `delegate` for the people below the leader.
- **A level says whom its people may message** (`levels.people`, `people/policy.js`): `org` (anyone active in the
  organisation; the default with `chat`), `team` (their manager, their peers under the same manager, everyone below
  them), `added` (only conversations others add them to — a guest; the default without `chat`, so a viewer reads where
  added and writes nothing). Settings → Users → a level's "Whom they may message". A level never messages further than
  the person making it.
- **Channels**: an organisation's are made by people holding `users`; a team's by its leader (`delegate`) or `users`.
  Anyone the channel is for may browse and join it.
- **Nobody reads a conversation they are not in — an admin included.** The one exception is the owner's compliance
  export (`POST /api/people/export`): the owner's alone (`org`), asked with the password (`auth/guarded.js`), written in
  the audit. The panel says so where the export is.
- Files are attachments: a person sees them in the conversation; the attachments store is shared, as it was before.

## Your agent, brought in

- `@orchestrator` (or `@agent`, or a specialist's id while specialists are on) in a message asks the **writer's own
  agent**: a conversation of theirs per space (`agent_session`, kind `chat`, under their own Orchestrator, claimed by
  them) gets one message — the space's last fifteen lines and the request — as a turn of that person: their level,
  approvals, budget and allotments, exactly as any turn of theirs. Every turn that ends there (that one, and later ones —
  a specialist reporting back) has its final answer posted in the space, labelled "<name>'s agent".
- The agent has **no tool that reads the hive chat**. What it sees of a conversation is what a person brought in, and
  `recall_conversations` finds only those bridge conversations. A conversation nobody brought it into is one it never
  sees. (A host can open every agent conversation, so what a person brings to their agent is readable there by a host,
  as all agent conversations are; the people conversation itself stays its members'.)
- **Everyone sees their own Orchestrator** (`harness/own-main.js`): the hub's main Orchestrator is its owner's (the first
  person who wrote in it, or a host while nobody has); anyone else gets one of their own, made the first time they
  write. The floating chat, its history, Clear and the Deep call's "heard" all use it. Before, the floating chat wrote
  every person into the hub's one Orchestrator and its history read it back to anyone signed in.

## On screens and devices

- **Controls → Chat** (`people`): the list (your agents first — your Orchestrator, your work chats — then direct
  messages, groups, channels, channels to join) beside the open conversation; your Orchestrator opens there as the
  floating chat itself, docked into the page. **The floating chat** has Agent | People; the unread count rides on the
  switch and the chat button. A person's card (from a name, the tree, Settings → Users) and the organisation tree.
- **Live**: the live feed's `chat` topic goes to the space's members alone (a host's page does not hear a DM it is not
  in); `org` when the tree changes.
- **Devices** (`/api/v1/people…`, `harness:chat`, PROTOCOL §23.3): list, read, write, react, mark read, typing.
  `people.message` (durable), `people.typing` and `people.read` (ephemeral) to every member's devices; a DM or a mention
  also as an `alert` with `ext.people`, outside quiet hours and unless muted. Making and arranging spaces is a gap
  (`people-manage`).
- **Calls and screen sharing**: 📞 and 🖵 in a conversation's header call `window.peopleCallProvider.start(kind, space)`
  when meetings register one, and say they are coming until then.

## Licence

Its own code, **`people`** (Studio, Hosted, Complete; `all`). A small hive without it still works: the routes, the page,
the floating chat's switch and the tables are absent, the floating chat is the agent's alone, and the organisation tree
— core, beside accounts — stays. Chat between people is what a team buys; a person alone with their agent does not
need it.

## Not yet

Calls and screen sharing (meetings); a device making groups and channels; full-text search per engine; per-person
retention.
