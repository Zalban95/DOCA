# Audit: what DOCA's agents know about their tools, and what they can use (2026-10-06)

Asked 2026-10-06 ("check if the system is … aware of everything they have at disposal"), against CONSTITUTION P13, P14,
V8 (the panel chooses its tools) and §1 (weaker models do the work because the tools are ready). Read-only: a
throwaway hub booted, the real prompt (`agent.preview`) and tool list (`tools.schemas(disabledFor(...))`) dumped for
the Orchestrator, a work chat, a no-conversation call and every shipped specialist, with specialists off and on.

**Size.** The Orchestrator holds 47 tools; system prompt ≈5.6k tokens, tool schemas ≈11.9k → ≈17.9k per step,
≈143k worst case at 8 steps. A work chat ≈5.9k + 11.9k. The charter alone ≈1.6k.

Findings, most important first. Each ends with the TODO it became (TODO.md, section "Audit 2026-10-06").

## A. The Orchestrator is not given the facts its own tools point at

1. **It is never told which specialists exist.** `turn/prompt.js:99-106` omits `agents.block()` (only the work-chat
   branch has it, `:154`), yet `agent_dispatch` says "one of the specialists listed in your prompt" and the web line
   says "dispatch the scout". → Roster in the Orchestrator's prompt; a test that `preview()` names every enabled
   specialist whenever `agent_dispatch` is held.
2. **It gets a 3-line brief, not the environment: no MCP servers, no machine placement.** `prompt.js:102` uses
   `environmentBrief()` and no `placeBlock`; `mcp_connect` says "the environment lists them". A phone's or DocaDesk's
   hands are invisible until running, and then only named. → A compact MCP-servers section (id, state, machine,
   `toolSummary`) and `placeBlock` when a client-hosted server exists; a test that every prompt holding
   `mcp_connect` lists the servers.
3. **With specialists on, the airlock removes `http_fetch`, `research_docs`, `web_search` from the Orchestrator and
   work chats** (`agents/registry.js:64` AIRLOCK_ONLY) — but `hi3d`, `service_draft`, `smart-home` (a Shelly on the
   LAN) and `mcp_draft`/`service_draft` ("research_docs first", both in NEVER) depend on them; `connector_*` is not
   airlocked, so a connected account works and a pasted key does not. → Decide the airlock's scope: a keyed
   `http_fetch` to a Keys-for-services origin and owner-listed LAN/loopback addresses stay with every agent; the open
   web goes to the scout. Meanwhile no prompt text names a tool the prompt does not hold.
4. **`computer` promises the Orchestrator its tools; `othersComputers()` strips them from it.** `computer_login`
   needs refs it can never get; `computer` sits in the Organization kit; with specialists off, "pass it as computer:
   to agent_dispatch" names an absent tool. → Say only work chats and specialists work inside a computer; drop
   `computer_login` where no computer tools are held; move `computer` to the Computer kit; drop the dispatch clause
   when dispatch is off.

## B. Capabilities the hub has that the agent cannot reach

5. **Phones operate the hub through `/api/v1` commands; the agent has no equivalent** (`api-v1/commands.js`:
   services, llama.cpp, docker containers, compose, snapshots, panel.restart, skills.toggle). "Start whisper" becomes
   hand-written `docker run`. → `hub_command {id, params}` over the existing registry, `confirm` commands asked, never
   "always", `drain.js` for restart; a coverage test.
6. **Weather and today's calendar exist (ambient) but not for the agent.** → A FREE `today` tool returning
   `/api/ambient`'s JSON for the turn's person; a "morning brief" skill/recipe.
7. **No one-off reminders or timers** (`schedule` is every-N/cron and created `proposed`). → `remind {at|in, text,
   device?}` delivered by `tell_device`, the person's own request so no click; repeating schedules keep the click.
8. **No screen control**: can't send a page to a screen; `ambient`, `call`, `face`, `voice` are not proposable. →
   `screen {list | show | propose}`: showing asked, settings through the proposal tray at one screen's layer.
9. **`system_status` knows only Ollama and DOCA's own llama-servers** — not `model-servers.js` or `inflight.js`. → Add
   model servers ("working for DOCA: …" / "for something else") to `system_status` or a `model_servers` tool.
10. **No agent path to wake-word training, evals, Workstream, served pages, DOCA's own logs and traces.** → For each,
    decide tool / recipe / a person's alone and record it coverage-style; cheap wins: `wakeword train` (asked),
    `evals run` (P19), served pages listed in `canvas preview`, read-only `logs`/`trace`.

## C. Contradictions and identity noise (P14)

11. **Work chats are told both "stay free, hand over anything multi-step" (`agents.block()`) and "own its detailed
    work" (`organization.block`).** → Split the roster from the role note; "stay free" for the Orchestrator only.
12. **The Orchestrator is told who it is three times** (Orchestrator line, persona, `DEFAULT_SYSTEM_PROMPT` as the
    worker). → A coordinator default prompt of its own; identity once.
13. **The charter names tools specialists don't hold, and the git rules (≈450 tokens) reach every turn, a watch's voice
    turn included.** → Render tool-specific sentences only when the tool is held, the repository section only with the
    Code kit; a test that every backticked tool name in a rendered prompt is in its tool list.
14. **The tools preamble is generic and wrong for some readers** (`tools-section.js:38`, `untrusted.RULE` tells the
    scout to send the scout; specialists get the Organization heading). → Build it from the tools held.
15. **Misfit tools**: `scout_report` and `mission_plan` offered with specialists off; `show_image` (a deprecated alias)
    still in the schemas. → Give them only where they fit; keep the alias at call time only.

## D. Descriptions and choosing between tools

16. **19 of the Orchestrator's 47 "Your tools" lines are cut mid-sentence** (`firstSentence(max = 150)`, one at
    "e.g."). → A stricter test (≤150 chars, no e.g./i.e. split, no trailing …) and rewritten first sentences.
17. **Key tools' first sentences don't say when to use them** (`work_chats: Manage the three-level workspace.`,
    `project`, `schedule`, `recipe`, `shell_job`). → One convention: "<verb> … — use when …".
18. **Many-action tools with undocumented parameters** (`work_chats` 10 actions, `project` 12, `computer` 7, `recipe`
    6, `memory_rules_write` ≈720 tokens). → Describe every parameter with its actions; split the hottest paths
    (`work_chat_start`, `project_run`); reject missing action-specific fields by name.
19. **The ways out (http_fetch, research_docs, web_search, connector_*, the scout, service_draft) overlap with no
    decision rule.** → One rendered "Reaching outside" block built from what the turn holds.
20. **MCP tools are named, not described; `doca_clients` never says a device lends hands.** → `hands=<server> (screen,
    apps, media…)` per device; one line per MCP server in Your tools.

## E. Skills and recipes

21. **Which skill to use is left to the model**; `skill-match.js` is used only by `skill search`. → Match skills and
    recipe titles against the person's words each turn ("Likely fits: …" in the readings); measure with a routing
    evals set.
22. **Saved recipes hide at the end of `recipe`'s description** (never in Your tools, and they break the cache). → A
    "# Recipes you have" readings section, top N by relevance; out of the schema.
23. **Shipped skills and descriptions name things that don't exist**: `jdk21` (the row is `jdk`), `catt` (no row),
    `reach-another-machine` names DocaDesk's tools for doca-client, `make-a-specialist` misses kits and points to
    `settings_read` for a path, `doca-dev-cycle` calls panel routes the agent can't. → `test/skill-references.test.js`
    and the five fixes.
24. **Common assistant jobs have no skill**: calendar and mail through connectors, a morning brief, web research with
    sources, reminders, "what is my machine doing", photos and attachments, a service that won't start. → 4–6 short
    task skills on existing tools, each ending with `recipe save_last`.

## F. Size, and what a small model can carry

25. **≈17.9k tokens every step, many for rare tools** (`memory_rules_write` 719, `mcp_draft` 440, `service_draft` 400,
    `pack` 257, `tool_note` 203, …; the memory rules block ≈700). → Tiers: core tools always, rare ones named in one
    line and attached when named or when a skill/recipe calls them; a compact profile for small windows.
26. **The Orchestrator holds every kit (`kits: '*'`) while told to stay free**; the code hands off after
    `orchestratorWorkSteps: 3` but the prompt says "a few". → A lean default kit, or the exact number in the prompt.
27. **Routing (answer / one tool / recipe / skill / work chat / specialist / ask) is spread over four places.** → One
    decision table with an example each, at the top of the Orchestrator's instructions, backed by `evals/routing.json`
    run against a small local model.
28. **The panel's prompt breakdown under-counts work chats by ≈40%** (`turn/introspect.js` omits Your tools, skills,
    specialists, permits, human block, installs, project brief). → Measure from the parts `systemPrompt()` assembles;
    a test that the parts sum to `preview().length`.

## G. Other

29. **P13 is tested for tools only, not for the facts descriptions promise.** → A coherence test per profile: every
    reference a held tool's description makes ("listed in your prompt", "the environment lists", named tools) is
    present in that profile's rendered prompt.
30. **Changing inventories (keys, logins, recipes, computers, tool notes) live in tool descriptions**, breaking the
    cache and missing from the summary. → One "# What you have" readings block; static schemas.

**Not checked:** any real model's behaviour; the call/assistant client block; an install with MCP servers,
connectors or computers present (read from code, not dumped).
