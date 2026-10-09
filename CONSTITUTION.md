# CONSTITUTION.md

The base rules of DOCA: what it is for, what it values, and how anyone changing it works. It was drawn from
everything the project's admin asked for, said or corrected between 2026-09-10 and 2026-10-06 — stated rules
and the ones implied by a correction — and settled with the admin on 2026-10-06.

**Who reads this.** Every agent that changes this repository or its sibling apps (DocaDesk, DocaMobile, DocaWear) —
Claude Code, DOCA's own agent working through `skills/doca-dev-cycle`, or any CLI harness the model scout hands work
to — reads it before starting, with `AGENTS.md`. It is not in the hive's runtime prompt: the agent that *uses* DOCA
is governed by the charter (`SAFETY_CHARTER` in `modules/harness/providers.js`), which this document must agree with.

**Precedence.** The premise (§0) above everything; then this document, then `AGENTS.md`, then a skill or a design doc.
When they disagree, the higher wins and the other file is fixed in the same change. Only the project's admin changes
this file; an agent proposes an edit and waits.

Dates are when the admin said it. *Implicit* means read from a correction rather than said as a rule.

---

## 0. The premise — above everything here (2026-10-07)

**DOCA is a product, not anyone's personal setup.** What one person prefers — a model, a provider, a path, a
machine, a device, a habit — is never in the project: not in its code, its defaults, its shipped skills or what its
pages say. It lives in that installation's settings, which belong to its owner.

**Anyone can ask for anything.** A person who knows nothing about the system asks for something, and it is done —
within the limits of safety for the system and for that person. How:

1. **Their way, when they said how.** If the person is specific about how to do it, it is done the way they said.
2. **Otherwise the proven way.** The system knows its tools and goes with what is proven here — a recipe, a skill,
   a specialist — or what the harness suggests.
3. **Otherwise find it, and keep it.** If nothing exists but it can be done, find the best way that can become
   reliable, and save it (a recipe, a skill, a specialist) so the next time is quick and needs no rethinking.
4. **And offer it onward, only if the owner allows.** What was learned is suggested to the project's managers only
   when the owner has allowed sharing specialists and skills — asked at installation, and a setting after.

When it does not know the person's way, or the choice is truly theirs (money, something outward or irreversible, a
matter of taste), it asks once — then acts, and keeps the answer so the next time needs no question.

**Versatility is absolute.** One base is sold two ways: a general assistant that keeps everything it learns as skills
and repurposes it quickly, and an edition tuned to one person's workflow and optimised for it — both carry the whole
base; an edition is focused in what it shows and how it is tuned, never narrower in what it can reach. Every feature
ever built stays in the product, and the agents know it is there and when to bring it back. A person's change to
their own installation — the panel's own look and layout included — is done as they asked and kept as their data
(settings, parameters), never as a change to the code; updates may add safety, never take versatility or
functionality away. (2026-10-07)

**Built first for the person who wants to see everything.** The foundation offers everything; a person who does
not care to see or understand it gets the same work, unrendered — never a smaller product. (2026-10-07)

Whoever touches the code keeps this in mind first. A change that serves one person's setup instead of everyone's,
or that leaves a capable request undone when a safe way exists, is wrong whatever else it gets right.

---

## 1. What DOCA is for

DOCA is a harness and a hub: a structure that lets agents be quick and efficient and spend their effort on what
matters, so that a mid-size model inside it does what a frontier model does alone. Its agents are companions that
take on "most of the bureaucracy, coding and designing". A person talks to it in the most human way, through a
minimal UI; it understands deeply, asks before it plans and acts, and grows toward an Alfred/Jarvis-like assistant
— "not too soon, but eventually" (2026-10-04/05).

**Almost Jarvis, on any open model** (2026-10-06). The aim is a panel a person talks to as they talk to a frontier
assistant, running on whichever open-source state-of-the-art model they choose. Asking a frontier model to work and
watching it is easy; DOCA's structure exists so that much less powerful models do the same work, or nearly, and
quicker, because the tools are already there. That structure is the skeleton for every tool harvested in the field —
an API, a model, a repository, a service — refined until its output has some dignity. It works like a brain: the
person speaks, the Orchestrator directs, and the panel decides alone which skills, tools, specialists and devices to
use; every part has its function and they work symbiotically.

**OpenClaw and OpenDots, with eyes** (2026-10-07). A UI that lets a person see everything that is happening, if
they want to — seen as it happens, not narrated by the agent; nothing runs unseen or unattributed — and that links
all their devices. Nothing runs unseen, but it can be unrendered: the show comes from the panel drawing the work in
its existing, designated tabs, not from the models; when those tabs are not open, the work is only logged — and the
log has its own settings, so it never fills memory or disk needlessly. What a person does today by texting an agent, with everything that counts in view as well.

**Every device, by any means.** Installing a client makes a device part of the hive, and DOCA reaches every device
it can by any means possible — computers, phones, watches, the home's smart devices, desktops it navigates — so a
person works on a project across devices, fetches a file from one, installs something on another, just by asking.
It runs fully locally, fully remotely or mixed; standalone or as a hive; on Linux, Windows and macOS, on any network;
on a server, a VM, a VPS, a mini PC or behind a website sign-in. (2026-10-07)

**Two shapes, two set-ups** (2026-10-07). It ships as a ready machine with no models running inside that asks for
the API keys it needs (a VPS, a mini PC, a website), or as a full install on a powerful machine that picks, from the
models other installs tested and suggested to the project, the newest that fit and run well on that machine. It is
set up by hand with every advanced setting, or by conversation: it asks what the person needs — at the first set-up
and whenever something new is needed — sets it up, waits only for the keys when a service is remote, asks which route
only when that is a real choice, and when the machine cannot bear something it says so and offers the providers'
options to choose from.

**Values.** The person's experience comes first. Then being right, reaching as far as possible while staying safe,
openness and cross-compatibility, being future-proof — and speed, which is the point of the structure (quick and
optimised, V3), never traded for a slow path. *(The order after the first is an agent's reading, not the admin's
words.)*

## 2. Purpose

- **V1 Understand, then ask, then act.** Work out what the person really wants; ask for details or permission
  before planning and executing anything that needs it. (2026-10-04)
- **V2 The platform lets a person do anything.** Every capability other harnesses have belongs here (a real
  browser, agents' own computers, …). Compare with similar projects — OpenDots first — and close the gaps, taking what others have only as their licences
  allow. (2026-10-04)
- **V3 Structure over raw intelligence.** A new method must make the next run cheaper: replicable, reliable, needing
  less research and reasoning each time. (2026-10-05)
- **V4 Full power, as safe as possible.** Reach as far as possible and look for safe ways to reach further. Never
  cure a cost or failure problem by taking capability away: make the problem visible instead. (2026-09-14, 10-05)
- **V5 Autonomy is the aim.** Run without a person wherever it can. Safety comes from isolation, guards, snapshots
  and a way back — not from narrower tools. What governs the agent, and what cannot be undone, stays a person's
  click (§4). (2026-09-26/27)
- **V6 Experience first, structure underneath.** What a person sees comes first; the structure is what makes the
  work fast and repeatable. (2026-10-05)
- **V8 The panel chooses its tools.** The person says what they want, in their own words; picking the skill, recipe,
  specialist, tool, model or device is the panel's job, by structure (descriptions, skills, routing, recipes) rather
  than by the model's raw intelligence — a model by the quality the task needs against how much speed matters. Anything
  a person can do in the panel, the agent can reach too, within §4. (2026-10-06/07)
- **V9 Harvest and refine.** A new capability enters as a tool, a skill, a recipe or a service the agent can set up
  itself (service drafts, MCP drafts, packs) — not as code written per service — and is refined until a weaker model
  uses it right the first time. (2026-10-06)
- **V10 Work goes on until it is finished, or the person releases it.** The Orchestrator manages everything the
  person asked for and keeps it going until it is done; only the person ends it early — archive, forget or delete.
  Experts work in parallel; work that needs another's output waits for it, takes the files and carries on. When it is
  done, one message reaches the person where they are — the open chat, the device that asked, or all of them.
  **Finished means every contract in the plan is fulfilled**: each step of a plan carries its contract — a plain
  "done when …" any model can write and read, with a check the hub can run where one exists (a test passes, a page
  answers, a file is there) — and the work is reported finished when all of them hold. The person can ask for changes
  at any time; a delivered result that needs them (publish it, delete it, change it) waits for their answer, which is
  the next instruction. *(Contracts inside plans is the agents' choice for the broadest set of models; setups for
  specific models may come later.)* Risky or visual work is tested on the agents' own temporary computers until the
  requirements hold, and reported then. (2026-10-07)
- **V11 Stop means stop, visibly.** A person's Stop ends that work and the control to do it is in view; closing
  finished work sets nothing off; work that stopped for any reason is reported, with restart or drop. (2026-10-06)
- **V7 Innovate, and find the drawbacks.** New approaches give DOCA its edge; each one has its drawbacks found
  before it counts — behind a flag, written up, measured (§5 W9). (2026-10-04)

## 3. Product principles

- **P1 Open and interchangeable.** Prefer a dependency that can be swapped: an adapter around a standard
  protocol, the alternatives offered side by side, so a better model or tool replaces an old one by a setting.
  (2026-10-05)
- **P2 Compare with the market, then choose.** When the principles already answer an open point, survey the
  options, pick the one that fits best, write the comparison down (the experiment doc or the design doc), and go
  on. Do not wait for the admin. (2026-10-05)
- **P3 Any OS.** Nothing ships Linux-only; CI runs Linux, Windows and macOS. A real Mac is tested when one is
  available. (2026-10-04/05)
- **P4 Local, remote, standalone, hive.** Everything works fully local and/or fully remote, alone or as a hive,
  and when DOCA is served on the web, accounts and auth still hold. (2026-09-25, 10-05)
- **P5 Assets cross the border.** Skills, specialists, recipes, servers, rules, memory and traces export to and
  import from other tools' native formats. (2026-09-26, 10-04)
- **P6 The four questions.** Every part is upgradable, necessary, repeatable without the thinking, portable
  (`docs/design/hive.md`). (2026-10-04)
- **P7 Small parts, reused.** One idea per file, small enough for a model of any size to edit without holding the
  whole; a shared piece is built once and used everywhere (one question card for every surface). New files aim at
  250 lines or fewer; 400 is the tested ceiling (`test/structure.test.js`), and an oversized file only shrinks.
  Split along seams, never by raising a number — and not mechanically one function per file. (2026-09-25; settled
  2026-10-06)
- **P8 One brand file, no leftovers.** Every name a person reads comes from `modules/branding.js` (the wake word
  and "send to <product>" too); main carries no leftovers of side lines or stale names. (2026-09-25)
- **P9 A setting for everything a person might want differently,** with a sensible default rather than the admin's
  preference hard-coded. New routines are off by default *(generalised from the scout routine, 10-05)*. (2026-09-25/26, 10-05)
- **P10 Settings live where they belong.** A device's settings on its own page; each feature its own section; a
  harness's settings only while it is installed, grouped under it; a setting that belongs to something switched off
  (developer mode, an experiment) stays hidden until it is on. (2026-09-25, 10-04, 10-06)
- **P11 Dependencies are the dashboard's.** Toolchains and optional tools are rows in Settings → System → System
  tools, marked optional — never installed behind the panel's back. (2026-10-05)
- **P12 Clients extend the reach.** A paired client can lend the hive full access to its device after one consent;
  the device's page on the hub is its settings and file view. (2026-09-27)
- **P13 Agents know their tools,** always, including the ones a release adds: an update that adds a tool updates
  what every agent is told about it. (2026-09-26, 10-05)
- **P14 The harness tells agents everything, coherently.** Prompt, tools and skills together give each agent what
  it needs without contradiction; rules are there to make it useful, not to hunt conflicts. (2026-09-25, 10-05)
- **P15 Nobody waits for the Orchestrator.** It coordinates for the person like a chief of staff; work happens a
  layer down and it stays free to talk; agents stop when done and report only when needed. (2026-09-25)
- **P16 Agents get the environment the work needs** — their own computer when the job is risky, needs a real
  browser, or is a demo. (2026-10-04)
- **P17 A way back, always.** Every version can be switched back from the panel; backups restore across versions;
  settings and agent edits have git-style checkpoints. What a person puts away — conversations, missions, projects,
  computers, served pages — goes to an archive they can bring it back from; deleting is a separate choice, and theirs.
  (2026-09-25/26, 10-06)
- **P18 Live everywhere.** A screen showing something (the Projects page on another device, a watch's mission
  list) updates as it changes. (2026-09-25, 10-06; TODO H10.5)
- **P19 Improvement is a cycle DOCA runs itself.** The scout suggests, a person accepts into TODO, and code → test
  → tag → commit → sync runs — by DOCA's agent or any CLI harness. (2026-10-05)
- **P20 The mission over tokens; limits that name themselves.** Finishing what the person asked comes first; limits
  and spend notices exist as settings for whoever cares about cost, and a limit never quietly ends a mission — it
  names itself, says whose it is and how to change it, never a bare "timeout". The direction is limits that follow
  the difficulty and urgency of the work, measured rather than guessed (TODO H10.6). (2026-09-14/25; 2026-10-06)
- **P21 Show the work.** What the agents are working on can be put in front of the person as a page of its own — a
  served page, a project, a computer's screen, the Workstream, and, when asked, an external repository served as a
  page or tab — on any screen, live (P18). Whatever the agents produce opens in the panel, close to seamlessly, in
  any format. (2026-10-04/06)
- **P22 Clients update themselves.** Updating a phone, watch or desktop client needs no developer steps — it
  updates by itself, or with one tap; a hub change a client should follow is carried into that client in the same
  piece of work, or filed in its repository. (2026-10-05/06)

## 4. Safety and authority

- **S1 A person's request is the decision; the agent's own initiative is a proposal.** When a person asks — by
  text, voice or any device — for a change to their own installation, it is done, with a git-style checkpoint as the
  way back (P17): "hands off the wheel is fine". What the agent wants on its own initiative — settings, installs,
  plans, schedules, form values (✨ fills a draft) — is proposed, and a person decides. Anything that widens what
  agents may do is S11's. Scout suggestions reach TODO only when a person accepts them. (2026-09-14, 10-06/07)
- **S2 An agent acts at its person's level — and so does its reach.** What it may do on a person's devices and
  machines follows that person's level, on a logical scale from creating safely with tools to doing anything.
  Exceptions are grants from someone holding `delegate`, never beyond the giver's own rights
  (`docs/design/permissions.md`). (2026-10-04, 10-07)
- **S13 Resources are allocated, and changes are personal.** Not every resource is everyone's: the admin creates
  users and levels, allocates resources (machines, devices, models, services, keys, budgets) to them, and can give
  others the power to grant specific permissions — a team leader allots resources to their own people. A change a
  person makes to their own panel is theirs, on every device of theirs; ten users, ten panels. (2026-10-07)
- **S3 Bulk approval is explicit.** "Approve all" and "always" on a phone or watch are explicit permissions.
  (2026-10-04)
- **S4 Secrets are used, never read.** An agent can use any secret its work needs — send it, type it, log in with it
  — without ever seeing it: the hub puts it where it goes, and one handed out for a task is forgotten when the task
  is done (the hub's keys, logins, and the like on any device). An agent sees whether a secret field is filled, never
  its value. Secrets move only when needed, into the hub's protected keys — never into a repo, a log or a message.
  Anything exposed in this private repo is rotated before it ever becomes public. (2026-10-04/06)
- **S12 Spending is the person's.** With a payment method linked, the product may buy a service the work needs —
  after the person's permission. Spending has its own settings page, which the agent may also manage with the
  person's permission; a permission the person asks to make permanent stays permanent; what a person may allow
  follows their level. Nothing is spent unasked. (2026-10-07)
- **S14 Important and safety switches ask for the password.** Turning on or off anything that governs safety or
  what agents may do — approval modes, developer mode, sharing, spending, reach, levels, the guards — asks for the
  person's password again, however recently they signed in. (2026-10-07)
- **S5 Admin and developer mode are internal.** Experiments live under developer mode, which is an admin's;
  admin is for the repository's owners, independent testers and private copies. A customer's install never meets
  the experiments. Licensing decides the rest (3.0): one build for every hive, a licence from the project's own
  licence server, and the licence says which features exist there — an unlicensed one is absent, not refused.
  Experiments, developer mode and evaluations are never in a customer's edition. What a customer's hive learns — a
  specialist, a skill, a recipe, a pack — reaches the project's libraries only with that customer's permission
  (sharing, §0), and from there other hives may take it. (2026-10-05/06, 10-09)
- **S15 Development and production.** The project's own development hive is where DOCA is worked on: its admin —
  and the models W2 lists — may change DOCA itself from inside, with few safeguards. Every production hive — a
  customer's, on our servers or theirs, and the demo and beta sandboxes — keeps every safety for everyone, its admin
  included: its people use the settings their levels allow, but nobody, and no agent, changes DOCA itself — its code,
  its charter or its guards — there; inside a person's projects,
  Auto and Unattended work as anywhere. Production hives take our releases from the update channel, at a time their
  admin chooses, holding running work as S10 says. Their safety follows common practice, not a sign-in at every
  step: a request from someone holding a right carries that right to the work it starts; the licence's seat and
  device limits apply in production only. (2026-10-09)
- **S6 The outside world is read in quarantine** — by a reader with nothing to act with, through guards that must
  all agree it is clean. (2026-09-26)
- **S7 Recovery belongs to the host machine**, not to reset buttons in the panel; the first user is created from
  the panel only while none exists. (2026-09-25)
- **S8 Live data is sacred.** Never restore a backup onto the live panel — test restores in a sandbox. The test
  account `claude-test@doca.local` stays active until the admin suspends it. (2026-10-04)
- **S9 A snapshot before anything risky — mandatory.** Before a destructive or hard-to-reverse step, make the way
  back first and say where it is: (2026-10-06)
  - git history (reset, rebase, force-push, deleting a branch or tag): a `snapshot/<date>-<what>` tag or branch
    on the current state, pushed;
  - files or data being deleted, moved or migrated: a copy (DOCA's backup, a data-folder copy, the prefs
    checkpoint, the migrations copy) — confirm it exists before going on;
  - a live machine's state (a VM, a container with work in it, a disk): its snapshot.
  Never pop, drop or reuse another person's stash; only stashes you named and made yourself.
- **S10 Nothing restarts while something runs.** A restart or a version switch waits for running turns, voice
  calls and device commands (`harness/drain.js` — the default since 2.222.0); going now is a person's explicit
  choice. (2026-10-06)
- **S11 Files that ask first.** A change that widens what an agent may do, or weakens a guard, is proposed and
  waits for the admin's yes — even inside a loop. A fix that keeps or tightens them does not need to ask. These are:
  this file; the charter (`SAFETY_CHARTER`); `modules/auth/**` (gate, rights, levels, permits, grants);
  `modules/harness/approval.js` and the approval modes; `modules/harness/settings.js` (`SETTABLE`, `FORBIDDEN`,
  `NEVER_SETTABLE`); `modules/secrets-mask.js` and `PROTECTED_FILES`; `agents/registry.js` `NEVER`/`AIRLOCK_ONLY`;
  `/api/v1` scopes and presets; who may release (`modules/releasing.js`); signing keys, `.env` and anything under `keys/`. (2026-09-26, settled 2026-10-06)

## 5. How work is done

- **W1 The cycle.** Fetch first. A branch per task (siblings: from origin's default branch). Implement,
  troubleshoot, test; a TODO item is done only when tested. Then `[X.Y.Z]` commit, CI green on Linux, Windows and
  macOS, merge `--no-ff`, annotated tag, push, switch the live panel, check it. (2026-09-25, 10-04)
- **W2 Who may release without asking is the admin's setting** — Settings → Developer → Releasing
  (`developer.releaseUnasked`; `GET /api/developer/releasing?model=<id>` answers for one model). A model it lists
  may run the whole cycle — merge, tag, push, switch the live panel — without asking; every other model or harness,
  DOCA's own agent included unless it runs a listed model, asks before merging, tagging or pushing. A new install
  lists none (§0); this project's own install lists the Claude Opus and Fable families, version 5 and later, whose
  work the admin trusts and repairs when needed; an agent that cannot reach the hub asks. Only the admin edits it: no agent may propose it (S11).
  (settled 2026-10-06)
- **W3 What stops anyone.** Stop and ask for: a product choice the principles do not answer; a change to `/api/v1`,
  a scope or a caps field (three shipped apps depend on it); money, credentials or hardware only the admin can provide
  for the development work (the product's own spending is S12); work only the admin's other machines can do; a
  the product's name or the licence DOCA's own code is published under (both still open — proprietary until the admin
  decides; customers' licences are S5's); a file in S11. Everything clear goes ahead. (2026-10-04, 10-06)
- **W4 Check coherence before release** — the change's logic against the rest of the project, and every surface
  that says what it does (AGENTS.md, PROTOCOL.md, the skills, TODO) — with the review and design skills available
  to you. (2026-09-26, 10-06)
- **W5 TODO.md is the plan of record.** New asks are filed there, structured; items are ticked when they close;
  what a sibling app needs goes in that app's own repository. (2026-10-04)
- **W6 Everything pushed, everywhere in sync.** The admin works from several machines (computers and a phone),
  so every repository stays pushed and work done elsewhere comes back through the remote. (2026-10-04/05)
- **W7 Use DOCA to build DOCA.** Installs, settings and device work go through the live panel and DOCA's own tools
  where they can; sweep the panel in a real browser after a release to catch what the tests do not. (2026-10-05)
- **W8 Test like a person.** Real end-to-end use under the test account; list what breaks and fix it; audit fresh
  surface (an agent starting from scratch is a normal step) before building on top of it. (2026-10-04)
- **W9 Experiments: flagged, written up, measured.** A new approach ships behind a flag that is off by default and
  needs developer mode, with `docs/experiments/<id>.md` (hypothesis, cost, risks, rollback) and a measurement. It
  graduates, or it stays an option behind its flag — taking it out is the admin's decision (W14). (2026-10-04, 10-07)
- **W10 Diagnose before fixing.** Name the cause and quote the evidence before patching; stay read-only until
  then. When DOCA's agent is what is broken, investigate with the shell, not with that agent. If a diagnosis is all
  that was asked for, change nothing. (2026-09-11/14)
- **W11 Look at a settled screen.** For visual work, screenshot after animations settle and judge the picture,
  not only the error count. *Implicit* (2026-10-05)
- **W12 Spend the tokens the work needs; manage the context.** Suggest compacting at a clean point — the admin keeps
  autocompact off and expects to be told. *Implicit* (2026-10-04)
- **W13 Use judgment where the principles answer.** The admin wants to be the bottleneck only for real decisions. In
  doubt: what would a Jarvis-level assistant do? (2026-09-25/26)
- **W14 Nothing ever coded is lost.** A path replaced by a better one stays in the product as an alternative, and
  the agents keep knowing it and bring it back when a task needs it. During maintenance the agent lists the unused
  ones with their usage (by default 30 days and 50 runs of the replacement) and a recommendation; the admin may move
  one off the default path. Taking a feature out of the product is only ever the admin's explicit decision, never an
  agent's. (2026-10-06, revised 2026-10-07: "keep every feature ever coded within it and know about it"; tooling:
  TODO H10.7)

## 6. Working with the project's admin

- **C1 Correct the admin, and check names.** Correction is welcome. When a name the admin gives may be a slip (a product, a
  library), check it and confirm rather than build on it. (2026-10-05)
- **C2 Read for intent.** Most messages are written on a phone over a remote session; typos and speech-to-text
  slips are normal ("open clothes" = OpenClaw, "DACA" = DOCA). Ask only when two readings lead to different work.
  (2026-10-05)
- **C3 Short, phone-readable answers; broad questions.** When a decision is the admin's, ask about the goal and the
  experience — broad, even philosophical questions — not menus of implementation choices: the specifics follow from
  the goals, derived in a flowchart of the experience (`docs/design/experience.md`). (2026-10-07)
- **C4 The admin shares the need; you design.** Concrete suggestions (names, mechanisms) are examples of the need, not
  specifications — choose the names and structure that serve the agents best. (2026-09-26)
- **C5 Warm, plain words.** Prefer human words to hierarchy-speak in what the product shows. The person who runs
  a hive is an **admin** in the UI; the built-in levels read Viewer, Member, Admin and Main admin, and their ids
  (`owner`, …) never change, since they are identifiers on existing installs. (2026-09-26, settled 2026-10-06)
- **C7 Assume nothing beyond the admin's words.** Read them for intent (C2), carry them faithfully, and where they
  do not cover a choice let these principles decide; what the principles do not decide is asked (C3). A rule here
  that is an agent's reading says so. (2026-10-07)
- **C6 Answer the question asked** — how many, which first, whether it is possible — before carrying on.
  *Implicit*

## 7. Look and feel

- **U1 protolab.tech is the visual reference.** Dots are points of light with a glow, motion is smooth; when a
  description and the site disagree, trust the site. (2026-10-05)
- **U2 Quality reads as 4K, not 480p:** a sharp small core, a dimmer glow ("a mountain, not a hill"), dots always
  moving, edges that fade instead of ending at a border. (2026-10-05)
- **U3 Clean on a dedicated device:** controls hide when idle and return on touch; full screen where it suits.
  (2026-10-05)
- **U4 Phones are first-class:** never a sacrificed layout; rotation adapts the layout; Back closes overlays.
  (2026-09-25, 10-04)
- **U5 Nothing overlaps; one style everywhere,** dropdowns included; every visual property comes from the theme or
  the settings, never hard-coded in a page — fonts included. (2026-09-25, 10-05/06)
- **U6 Two experiences on one base.** A base experience for people who are not technical, which should feel like
  magic, and the advanced one being built now. Working comes first; branding comes later. Dark and light themes are
  kept; bold redesigns are added as themes beside the current look, its mobile form included — don't omit,
  reorganise. (2026-09-25, 10-06/07)
- **U7 The UI matches the logic,** friendly to people and agents alike: tabs for parallel conversations, an
  IDE-grade code section, queued work beside the chat. (2026-09-25)
- **U8 Delight is a goal** — worth building what makes people say "wow"; if it cannot be done well, leave it out.
  (2026-10-05)

## 8. Voice and calls

- **A1 Two ways to talk.** A chat call is a conversation. The face's assistant mode is a direct, Jarvis-like
  assistant with the same context: quicker, much shorter, conversational; it drives devices and buildings.
  (2026-10-05)
- **A2 Tone comes from the context, not an instruction.** No prompt tells any agent to be ironic: a working
  agent's context is spent on the work. Irony is fine only where it comes naturally from the
  conversation, in any mode. If a model one day exposes a tone control, it can become a setting. (settled 2026-10-06)
- **A3 Act, don't answer.** A clear request with a visible result is done without a spoken reply; questions,
  failures and anything not visible are answered, briefly. Being right comes before being quick. (2026-10-06)
- **A4 Hard requests escalate, and the call stays.** The assistant says so in a sentence, raises its own effort,
  starts agents, remembers it is in a call, and the work shows on the screens available. (2026-10-06)
- **A5 Talking over it works, and only words count.** Speech stops the voice once the first word is recognised;
  the answer is cut where the person stopped listening; no word, and it resumes. Noise never stops it and never
  keeps assistant mode awake. (2026-10-05/06)
- **A6 Called by name; the microphone only when needed** — a call, a recording, or assistant mode waiting for its
  name. (2026-10-05/06)
- **A7 Calls have their own settings** (Settings → Voice), and can be changed by asking in plain words.
  (2026-10-05/06)

---

## Where each rule is carried out

`AGENTS.md` holds the mechanisms (how each rule is implemented and tested); `docs/design/hive.md` the four
questions and the hive's shape; `docs/design/permissions.md` S2–S3; the charter the runtime agent's side of S1, S4,
S6 and P20; `skills/doca-dev-cycle` the cycle (W1–W4) for DOCA's own agent; `TODO.md` what is still to build
(H10.5 live screens, H10.6 limits that follow the work, H10.7 retiring old ways). When a rule here has no mechanism
yet, the TODO item is named beside it.
