# How we brief coding agents on client projects

A record of the pattern used for `DocaMobile` (Android phone) and `DocaWear` (Wear OS), so the
next client — a desktop app, a TV panel, another watch, someone else's device — starts from
something known to work instead of a fresh guess.

Nothing here is specific to Android. It is specific to *handing a whole project to an agent that
cannot ask you a question for the next four hours*.

## The briefs that exist

| Brief | Client | State |
|---|---|---|
| `D:\doca\DocaMobile\.agent\DOCA_MOBILE_BRIEF.md` | Android phone/tablet, and the companion hub that pairs everything else | Partly built |
| `D:\doca\DocaWear\.agent\DOCA_WEAR_BRIEF.md` | Wear OS watch | Partly built |
| `D:\doca\DocaMobile\.agent\DOCA_AUTO_BRIEF.md` | Android Auto, as a `:car-app` module inside the phone APK | Not started |
| `D:\doca\DocaDesk\.agent\DOCA_DESK_BRIEF.md` | Windows desktop (.NET 9 + WinUI 3) | Not started |

The two new ones are worth reading as examples of the pattern being used *against* a target rather
than for it. Each opens by naming the thing that makes the obvious plan impossible:

- **Android Auto** cannot draw. The Car App Library is a closed set of host-rendered templates, the
  screen stack is capped at five, over-refreshing a template throws at runtime, and Play only
  publishes car apps in a fixed set of categories that does not include "control panel". So the
  brief scopes the whole surface to prompts and alerts and says on page one that a store listing is
  not promised — because an agent handed "put the dashboard in the car" would spend a week finding
  that out.
- **Windows** can do everything, which is the opposite problem. Its brief spends its energy on what
  *not* to build: the dashboard goes in a WebView rather than being rewritten in XAML, and the one
  genuinely new capability — hosting an MCP server the harness can call — is fenced with a consent
  rule that outranks features, in the same slot where the watch's brief puts battery.

Both also inherit one server-side decision worth knowing about: an MCP definition now carries
`origin: { kind, deviceId }`, so the panel and the agent can tell a server running on a client from
one running beside the panel. A client **publishes a URL and a human registers it**; a client that
registered itself would be an unauthenticated way to get a command spawned on the host. `TODO.md`
has the detail.

## Where a brief lives

```
<Project>/.agent/<PROJECT>_BRIEF.md      # e.g. DocaWear/.agent/DOCA_WEAR_BRIEF.md
```

In the client repo, git-tracked, one file. It is the spec the agent works from and the thing we
edit when a decision changes — not a chat message, because a chat message is gone next session
and cannot be diffed.

The client repos sit beside the server repo on the same machine. That matters: the brief points
at the server's real files by absolute path, and the instruction is **read them rather than
guessing**.

## The skeleton

Both briefs converged on this order. The numbering shifts (`DocaMobile` has an extra section for
pre-existing code), but the sequence is the argument: *why we're here → what's true → how to
behave → what to build → how to prove it → when to stop*.

| Section | What goes in it |
|---|---|
| **0. Mission in one paragraph** | What this client is, and the one sentence that decides ties. `DocaWear`'s is "the watch is where an agent asks a human a question and gets an answer in two seconds." |
| **0.1 What this is not** | The wrong app it would otherwise become. Wear's says "a watch showing a file manager is a joke." |
| **1. Where the truth lives** | Table of every authoritative source with its absolute path: `PROTOCOL.md`, `docs/api/*`, `openapi.json`, the reference clients. Plus how to run a server and mint a token to develop against. |
| **2. Ground rules that shape every line of code** | Five or six numbered rules that apply everywhere. See below. |
| **3. Target architecture** | Module boundaries, platform baseline with versions, where models come from, the wire details that are easy to get wrong. |
| **4. What already exists** | Only when the agent inherits code. Per file: keep, rewrite, or delete, and why. |
| **5. Feature specification** | The bulk. One subsection per feature, in build order. |
| **6. Cross-cutting behaviour** | Things no single feature owns — the push loop, offline, errors. |
| **7. Security requirements** | Credential storage, transport trust, logging. Separate section so it cannot be skimmed past. |
| **8. Testing requirements** | What must have a test, and which ones run without a server. |
| **9. Milestones** | `M1`…`M9`, each with **observable acceptance criteria**. |
| **10. Explicit non-goals** | "Do not" list. Agents gold-plate; this is the brake. |
| **Appendix — constants, for reference only** | Every protocol limit in one table, explicitly *"so you recognise the behaviour, not so you hard-code it."* |
| **11. How to report back** | What to send after each milestone, and the short list of things to ask about first. |

## The ground rules that carried over

Four of these were in both briefs unchanged, and would be in the next one:

1. **Discover, never hard-code.** No id, limit, threshold, colour or string enum baked into the
   client. The server describes what exists; render what comes back.
2. **Forward compatibility is mandatory.** Unknown fields, event types and block types must be
   ignored without crashing, and degrade to text where that reads sensibly. The server adds
   things without bumping the major version.
3. **Fail loudly to me, quietly to the user.** No silent mocks, no fake data, no demo-mode
   fallback when a call fails. This one earns its place — the first `DocaMobile` scaffold
   shipped mock fallbacks that made a broken connection look like a working app.
4. **Least authority.** Each device holds its own credential and only its own. It never proxies
   for another device or acts on another's behalf.

Then one or two rules unique to the target, which is where the brief stops being boilerplate.
Wear's is **"battery is a correctness property, not an optimisation"** — a watch app that drains
the battery is broken even if every feature works.

## What actually makes these work

The parts that are easy to leave out and expensive to leave out.

**Write prose with reasons, not a bullet list of commands.** The agent will hit fifty decisions
the brief never mentions. It can only get those right if it knows *why* the listed ones are the
way they are. Every firm instruction is followed by the failure it prevents.

**Say what the reference code does wrong.** `clients/reference/watch.sh` is in the brief as the
answer to "what should this call look like" — and immediately flagged as not production quality,
with the list of what it skips (no status checks, no `If-None-Match`, no acks, no watchdog).
Without that, its shortcuts get copied into the app verbatim.

**Acceptance criteria must be observable, and verified against something real.** Not "pairing
works" but "pair from the dashboard, then add a surface server-side and watch it appear with
nothing hard-coded." `agent-sim.js` exists so the agent can raise a real prompt at itself; the
brief says **do not build UI for prompts you have never seen arrive.**

**Order milestones by what you most need to be right, not by dependency depth.** We had
code-entry pairing at `M2` and the phone bridge at `M6`, which meant the path essentially every
user takes was scheduled last. Building a fallback first leaves the real path under-designed.

**Amend, don't rewrite.** When the dashboard-in-a-WebView decision superseded a chunk of
`DocaMobile`'s plan, it went in as `§0.1 Amendment` with the superseded sections marked, rather
than a quiet edit. The next reader needs to know a decision was reversed and why — and a brief
that silently contradicts its own git history stops being trusted.

**Ask for what was wrong with the brief.** The report-back section asks for "anything in this
brief that turned out to be wrong, impossible, or ambiguous — with what you did instead and
why," labelled as the most valuable part of the report. That is the only feedback channel that
improves the next brief, and it is where the `DocaWear` milestone reorder came from.

**Gate the irreversible things with an explicit ask-first list.** Wear's is: adding an
undiscussed dependency, changing module boundaries, declaring a new capability, or putting a
credential on the Data Layer. Short enough to be read, specific enough to be obeyed.

## The workflow around it

1. **Server first.** The protocol, its docs and a working reference client exist before the
   client brief is written. A brief cannot point at truth that isn't there yet, and writing the
   reference client is what exposes the protocol gaps.
2. **Research the platform before scoping it.** The Huawei plan died on two facts that took an
   afternoon to establish and would have cost weeks to discover in code: Android Studio cannot
   build for a current Huawei watch, and HMS Toolkit is decommissioned in December 2026. Spend
   the afternoon.
3. **Write the brief, hand it over, let it run.** Milestone-sized, not task-sized.
4. **Amend on the report-back.** Both briefs have been amended more than once, and both are
   better for it.
5. **Keep the decision in the brief, in git.** If it only ever got said in a chat, it will be
   re-litigated.

## One thing to copy verbatim

The distinction that caused the most confusion across both clients, and which every future
client will need some version of:

> **Settings change this device. Profiles change what a device shows.**

App-local preferences and server-side state look identical in a settings list and behave
completely differently. Name the split early and repeat it in the UI copy.
