# What a device cannot do yet

Every capability lands in `/api/v1` first, so a client can have it (CONSTITUTION; TODO H11.3, D2b). The check is
`modules/api-v1/capability-map.js`: each thing a person can do in the panel is a row naming the panel routes that do it
and either the `/api/v1` routes that do the same for a device, a reason it is the panel's alone (mostly the machine's
own administration, a host's), or — here — its rank among the gaps. `test/api-coverage.test.js` fails on a route that
changes something without a capability, on a named `/api/v1` route the OpenAPI document does not have, and on a gap
missing from this page.

Filling a gap is a change to `/api/v1`, so it is asked first (CONSTITUTION W3); one marked **ask** also widens what a
device may do (S11) and is the owner's decision before it is a route. Until then a device reaches each of these by
opening the panel itself (`/d/<id>/`) in its web view.

Ordered by how much a person on a phone or a watch misses it:

| # | Capability | id | What for, away from the desk |
|---|---|---|---|
| 1 | Approve or reject a proposed plan | `plan-decide` | The plan reaches the phone as a document, and the work waits on a decision only the panel can give. |
| 2 | Accept or decline a settings proposal — **ask** | `proposal-decide` | The proposal is read on the phone (`GET /harness/memory`) and waits for the panel. A device applying a setting is a rule to change, not a route to add. |
| 3 | Hear an answer in the hive's voice; turn a recording into words | `speech` | A voice note or a spoken answer outside a live call (left from D1: speech with the device's voice). |
| 4 | See and withdraw a message waiting for a busy conversation | `inbox-withdraw` | A phone gets `202 queued` and cannot take back what it sent before it is read. |
| 5 | Send a specialist an errand | `mission-send` | Choosing who does a job without asking the Orchestrator to pass it on. |
| 6 | Rename a conversation, change its mode | `conversation-settings` | Switching to Ask or Plan before a risky request. Its approval switch stays a host's. |
| 7 | Choose a conversation's model | `conversation-model` | A quicker or stronger model for one conversation. |
| 8 | Save what worked as a recipe | `recipe-save` | "Keep that" right after a turn worked, from the device it ran on. |
| 9 | See what was put away | `archive-list` | Bringing a conversation back needs its id, and only the panel lists the put-away ones. |
| 10 | Make, run now or delete a schedule | `schedules-manage` | A device switches schedules on and off but makes none of its own. |
| 11 | Turn a device's family off or on, ask it again, refresh it | `device-control` | Revoking what a lost or misbehaving device lends, from another one. |
| 12 | Change this screen's look and voice | `screen-settings` | An app reads its effective settings and sets them only through the panel page in its web view. |
| 13 | See and remove the pages the agent made | `canvas` | A page the agent made for a person is shown on the panel only. |
| 14 | Correct, forget, lock or flag memory; edit its rules — **ask** | `memory-edit` | The shared memory is a host's to write until per-person memory; `harness:memory` only reads. |
| 15 | Link or unlink a chat app | `channel-link` | The link code is made once; a linked chat is itself a device. |
| 16 | Set what a device's console buttons do | `device-console` | Set up on the watch it belongs to. |
| 17 | Give or take back a grant — **ask** | `grants` | Delegating is S11's: the owner decides first. |
| 18 | See the home and act on it (lights, covers, heating, cameras) | `home` | The Home page (H10.10) draws Home Assistant for the panel; an app would draw the same areas and tiles natively, hear `state_changed` on its event stream, and call the same short list of services (unlock and disarm asking the person). Until then a phone opens `/?view=home` in its web view. |
| 19 | Put finished missions away at once, or keep one (📌) out of the tidy-up | `missions-tidy` | A phone archives one mission at a time; the hub puts the rest away by itself (agents/tidy.js). |
| 20 | Stop a team, keep it going, or put it away | `teams` | A device hears `agent.team` and draws the board; it stops one task's mission with `POST /harness/missions/{id}/stop`. Stopping the whole team, its keep-going switch and putting it away are the panel's until a route is asked for. |
| 21 | Make a group or a channel, join or leave one, add people, rename, pin, mute, edit or delete a message in the hive chat | `people-manage` | A phone reads, writes, reacts and marks read in its person's conversations (`/people`); arranging them is the panel's until a route is asked for. |

What is deliberately the panel's, with the reason beside each, is in the same file (`only`): the machine's
administration, the owner's secrets, budgets and spending (S12, S14), signing in, people and levels, the panel's own
layout.
