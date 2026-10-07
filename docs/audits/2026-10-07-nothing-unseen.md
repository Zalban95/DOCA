# Nothing runs unseen — an audit (2026-10-07, TODO P1.8)

CONSTITUTION §1: nothing runs unseen, but it can be unrendered. The panel draws the work in its existing, designated
tab when that tab is open; when it is not, the work is only logged, and the log has its own settings (TODO P1.12).
This audit lists everything that runs, the tab that draws it, and the log that keeps it when nobody looks. A row with
no log was a gap; 2.289.0 closes those with `modules/activity.js` (what the hub did on its own, Chronicle → "What the
hub did on its own", kept `logs.activityDays`).

| What runs | Drawn in (when open) | Logged (when not) | Attributed to |
|---|---|---|---|
| A turn (any conversation, any device) | Harness console, floating chat, Projects chat tab, Workstream | `runs` + traces (Chronicle), harness log | the person, the device that asked |
| A specialist's mission | Missions bar, its log window, Projects ↳ tab | `runs` (Chronicle), mission log (`agents/mission-*`) | the conversation that sent it, its person |
| A work chat | Harness side list, its tab, missions bar (devices: `agent.mission`) | `runs` (Chronicle) | its person, its parent |
| An automatic turn (supervisor wake) | Missions bar "working on its own", with why | `runs` + **activity: supervisor woke X, why** | the conversation; why it woke |
| A mission carried on after a restart | Missions bar | `runs` + **activity: missions carried on X** | the mission |
| An errand waiting on other missions, started | Missions bar | `runs` + **activity: started X's errand, after …** | the conversation that sent it |
| A schedule or reminder firing | Harness → Schedules (last run) | `runs` for a turn/recipe + **activity: schedules ran "X"** | its person |
| A recipe run | Its own conversation | tool calls in that conversation's run | its person |
| A device's command job | The device; Machines | `runs` kind `job` (Chronicle) | the device, its person |
| An agent's background shell job (`shell_job`) | Machines → Live (pages it serves) | job record + output (`logs.jobsKept`) | the conversation that started it |
| A model generating | Sidebar ◆ Model servers (DOCA's own requests named) | the run's trace (model spans) | the run |
| An inference service started or stopped | Field → Models / Services, Docker | the person's request (audit log); the agent's `hub_command` in its run | who asked |
| An agents' computer working | Computers tab, Machines → Live | its mission's run (tool calls) | the mission |
| A computer stopped when idle / removed by the tidy-up | Computers tab | **activity: computers stopped / removed X, why** | the routine (settings named) |
| An MCP server started with DOCA / resumed | Field → MCP | **activity: mcp started X, why** (and failures, as warnings) | the routine; the person who marked it |
| A channel bot listening again at start | Settings → Channels | **activity: channels X is listening again** | the host's switch |
| The model scout's daily look | Settings → Harness → Scout | **activity: scout looked …**; its brief is a turn (runs) | the person who switched it on |
| A scheduled backup | Settings → Backups | **activity: backup started / failed** | the schedule |
| The log keeper pruning | Settings → System → Logs (what each store holds) | **activity: log-keep removed …** | the log settings |
| Files an agent edits | Workstream (live diffs), Projects editor | the write in the turn's run (tool call by name, path) | the conversation |
| Settings changed | Settings (each card) | checkpoints (Settings → System → Checkpoints), audit log | who changed it |
| A wake-word training job | Field → Models → Wake words | its job record (one at a time) | the host who started it |
| An evaluation run | Settings → Evaluations | its result file (`logs.evalResultsKept`) | the host who started it |

Left as they are, on purpose:
- **The panel's own polling** (sidebar stats, presence) runs only while a page is shown, so a page is always looking.
- **Request audit lines** (`auth/store.audit`) already record every change a person makes through the panel.
- **Devices' own work** (a phone's sensors, a watch's call) runs on the device and is drawn there; the hub sees and
  logs what reaches it (bus events, runs).

How to check it stays true: a new background routine (a `setInterval` started in `boot.afterListen`, or a timer that
acts without a turn) writes one `activity.note({from, what, why, person?})` where it acts — `test/activity.test.js`
holds the routines listed here to it.
