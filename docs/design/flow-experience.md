# Flow — an experience beside the looks

Asked 2026-10-14: *"I kind of need to recheck the whole DOCA design. It works but it's not organized enough: the groups
of pages, the animations while navigating it, maybe also a bit to hide the transition times — they can be loaded at the
beginning with an opening loading. We can add this new experimental experience to the selection of the theme."*

A design was drawn for it ("DOCA Flow experience", five artboards: the opening, navigation on a side rail, the motion
spec, the choice in Settings → General → Appearance, the phone). This page is the audit that came first, what Flow
changes, and what it never changes.

## 1. How navigation works today

- **One page, every page in it.** `public/index.html` holds every page as a `div.tab-page` directly under
  `main.content`; `nav(name)` (`public/js/nav.js`) sets `currentTab`, toggles `.active` (display none ↔ flex), then
  calls each page's init for the pages shown. A page keeps its DOM when left, so the **second** visit to any page
  shows its last drawing at once and refreshes in place.
- **Inits come in two kinds.** One-shot inits read from the hub and draw (`modelsInit`, `mcpInit`, `vmsInit`,
  `dockerInit`, `archiveInit`, `harnessTabInit`, the Field pages' `fieldPageShow`, `settingsInit`). The others are
  `xxxTab(on)` switches that start something **only while the page is shown** and stop it when it is left: the
  Workstream's hold on the hub's sentinel, Home's connection to Home Assistant, Live's picture timer, the Teams,
  Chronicle, Admin, VNC, Nearby and Map refreshes, the Terminal's PTY, Logs' stream, the Files tree's folder watches.
- **Groups** (`public/js/nav-groups.js`, `NAV_GROUPS`): Controls · Agents · Machines · Hub · Field · Settings, as pills
  in the header with the open group's pages as a row under it; on a phone the groups are the bottom bar and a group of
  several pages opens a small menu. A person's own regrouping (`modules/panel-layout`, `public/js/panel-layout.js`,
  the `panel_layout` tool) rewrites `NAV_GROUPS` in place, layered install → person → screen.
- **`/?view=<page>`** (`solo.js`) shows one page alone; the calm everyday view (`focused/`) replaces the panel.
- **No movement at all**: a page change is an abrupt swap, and nothing marks where the person is going.

## 2. Where the waits are (measured)

Measured 2026-10-14 in headless Chromium against the panel on throwaway data (the harness of `test/panel-browser.js`),
the hub on the same machine. The scripts are kept outside the repository (`~/doca-tools/flow-measure/`).

**`nav()` itself is cheap**: 1–3 ms synchronous for every page (15 ms the first time for the Terminal). The wait is
in the round trips a page makes before it is drawn, and in placeholders a page puts up while it waits.

**Time until a page is drawn** — ms from `nav()` until the page holds no `.pulse` placeholder and some text; first
visit after a fresh load, then the second visit; "after a reload" is the same page's first visit after the panel was
loaded a second time in the same browser (the hub busier), against Flow at the same moment with its pages warmed:

| page | Standard first | Standard second | Standard after a reload | Flow after a reload | |
|---|---:|---:|---:|---:|---|
| models | 362 | 18 | 583 | **13** | warmed |
| connectors | 17 | 6 | 294 | **9** | warmed |
| vms | 47 | 4 | 154 | **6** | warmed |
| mcp | 22 | 5 | 39 | **11** | warmed |
| harness | 7 | 11 | 5 | 8 | warmed |
| apikeys | 5 | 7 | 4 | 9 | warmed |
| archive | 50 | 31 | 324 | 260 | warmed, but redraws "Loading…" on every visit |
| docker | 1619 | 2409 | 1841 | 2291 | warmed, but redraws its placeholders on every visit (`docker ps`, images) |
| admin | 107 | 5 | 189 | 114 | not warmed: refreshed on the live feed only while shown |
| computers | 69 | 5 | 298 | 156 | not warmed: its thumbnails only while shown |
| home · teams · live · vnc · map · nearby · meetings | 10–40 | 4–8 | 90–260 | 80–250 | not warmed (only while shown) |
| controls · people · ambient · logs · files · projects · workstream · chronicle · terminal | 2–15 | 2–8 | 2–14 | 4–11 | drawn from markup at once |

With the round trips slowed by 60 ms each (a phone over a tailnet), the network settled after a first visit to Models
in ~680 ms (20–29 requests), Harness ~350 ms (25), Connectors ~280 ms (14), API keys ~200 ms (10), Files ~230 ms (8).
Warming all eight pages took **0.85–0.93 s** in the background on the local hub.

What this says: on a desk next to the hub, most pages are already quick, and the second visit is always quick. The
waits a person feels are the **first visit** to the pages that read a lot (Models, Connectors, Harness, VMs, MCP —
the ones warmed), the pages that **blank themselves on every visit** (Archive, Docker — not cured by warming, see §5),
and the **abruptness** of the swap.

## 3. What Flow changes

Flow is a screen setting, `experience` (`modules/experience/schema.js`, declared in `settings-schema.js`), chosen per
screen in Settings → General → Appearance beside the looks: **Standard** (the panel as it always was) or **Flow ·
experimental**, with Flow's options folded under Advanced — warm at start (*every page I can open* | *the pages I use
most here*, counted per browser), motion (*gentle* 220 ms | *quick* 120 ms | *none*), group layout (*side rail* |
*top groups*). Never proposable: a look is the person's. The hub makes a saved value whole (`experience/index.js
normalize`), the browser keeps the same rule (`flow/flow.js flowNormalize`), and the page opens in the experience it
last used from `localStorage` before the hub answers, as the look does.

1. **Warming** (`public/js/flow/warm.js`). After the first page is shown, the pages in `FLOW_WARM` are drawn once off
   screen, one at a time while the browser is idle, in the order of the person's own groups (the open group first),
   at most 12 pages, 4 s each, 15 s in all — with **the same functions nav() calls for them** (a test holds each to
   nav.js's line). Only one-shot inits are warmed: Harness (DOCA's own console only — another harness's console opens a
   terminal), Archive, Models (with its roles, decision models, wake words, library cards: their own timers ask
   `currentTab` first), MCP, Docker, VMs, Connectors, API keys. **Nothing that opens a stream, a hold, a timer or a
   terminal is warmed**: Workstream, Home, Live, Terminal, Logs, Files, Projects, Teams, Chronicle, Chat, Admin,
   Ambient, Meetings, VNC, Map, Nearby and Computers keep their "only while shown" rule. One known effect: once
   Harness is drawn, its missions bar polls every 3 s while a mission runs, as it does after any visit today.
2. **The opening** (`flow/opening.js`). On a cold load — the first in a browser tab — warming runs behind a calm
   screen: the face's own points (`faceMount`, untouched, in its thinking state), a slowly turning ring of points, the
   product's name from branding, "Getting your pages ready — once, now; then every page opens at once", a thin bar and
   the groups ticking ready. It appears only if warming is not done after 300 ms (never a fixed delay), steps aside
   after 4 s whatever is left (warming carries on behind), a tap or a key dismisses it, and it waits on no live data.
   A later load in the same tab warms unseen.
3. **Motion** (`public/css/flow.css`, CSS only). 0 ms the tab answers; 0–120 ms the old page fades and drops 4 px
   (kept on screen for that by `flowNavBefore`); 60–220 ms the new one fades in and settles up 8 px — sideways 12 px,
   toward where the group lies, when the group changes; at 220 ms the page title takes the focus (never from a field
   being typed in). "Quick" halves it, "none" and `prefers-reduced-motion` never move. Live data fills in place; no
   spinners are added. A small readout under the rail says "opened in N ms · warm".
4. **The side rail** (`flow/rail.js`). The person's own groups — whatever their layout made of `NAV_GROUPS` — as a
   point, a name and a page count, Settings at the foot; the open group's pages stay the row under the header,
   underlined in the accent. The header's group pills step aside. "Top groups" keeps them where they are.
5. **Phone**: the open group's pages as chips at the top, the groups as the bottom bar, and a group in the bar opens at
   once (no menu).
6. **Flow's suggested groups**, one click, never forced: Home (Overview, Ambient, Home, Meetings, Chat) · Agents
   (Harness, Workstream, Teams, Chronicle, Archive) · Machines (Live, Computers, Nearby, VMs, Docker, VNC, Map) · Hub
   (Files, Projects, Logs, Admin, Terminal) · Field (Models, MCP, Connectors, API keys). The design's list left out
   Chat, Admin, Terminal, VNC and Map and named a "Library" that is a card of Models, not a page: they are placed
   where they fit, so every page is kept. The group ids stay (`controls`, `host`, `intelligence`: people's saved
   layouts use them); "Controls" is renamed "Home". Written as the person's own layer through
   `POST /api/screen/layout` (`panel-layout/ops.js` moves and a rename), undone with Undo beside it or in Your panel.

## 4. What Flow never changes

- What any page does, its routes, its rights, its data. Every page keeps its id and `nav()`.
- Standard: with it no attribute is set, no rule in `flow.css` matches, the rail does not exist and nothing is warmed
  (a browser test checks the panel as it was).
- The theme: Flow uses the screen's look and palette through theme variables only.
- The face: its points, shapes and motion are `faceMount`'s own.
- The "only while shown" rules of every page with a stream, a hold or a timer.
- A page served alone (`/?view=`) and the everyday view (Focused) are never in Flow.

## 5. What is left

- **Pages that blank themselves on every visit**: Archive ("Loading…") and Docker (its placeholders, and `docker
  ps`/`images` taking 1.6–2.4 s on a busy machine) wait on every visit whatever Flow does. Keeping the last drawing
  and refreshing in place is a change to those pages, one by one.
- **Settings' own sections** draw on `settingsSubNav`, per section; their first opening is not warmed.
- Warming is per browser tab: a reload in the same tab warms again in the background (cheap: under a second here).
- "Favourite pages only" in the design became "the pages I use most here", since the panel has no favourite pages:
  counted per browser by visits.
