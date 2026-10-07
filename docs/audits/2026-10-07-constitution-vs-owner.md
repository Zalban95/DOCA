# CONSTITUTION.md against the owner's own words

Inputs: `user-messages.md` (60 owner messages, 2026-10-04 09:28 to 2026-10-07 10:47; task notifications skipped) and
`CONSTITUTION.md` as it stands (with §0 of 2026-10-07). Quotes are verbatim, with speech-to-text slips left in place.
Where I read the owner's intent through a slip, the reading is in brackets. Timestamps are UTC.

The last message (2026-10-07 10:47) is weighted highest, as asked. It ends: "you can essentially forget all the
assumptions that have been made outside of my texts from this whole conversation because I am keeping roughly the
same line and just conceiving some safety adjustments. What the priority remain s that this tool has to be the most
versatile possible when it is sold."

---

## A. MISSING: what the owner said that the constitution does not carry

### A1. The person sees everything, if they want to
- **Owner, 10-07 10:47:** "It is basically makes of openclow and openDots but with a UI that lets you see everything
  that's happening if you want to and links all your devices". And: "Basically what I am doing with you but in a
  design that is not just texting or talking but also seeing everything that counts."
- **Owner, 10-06 18:07:** "I see the GPUs running something but the models on the left tab don't show on and in the
  harness I se no specialists working. When I close a specialist for some reason even if it was down something else
  starts working 🤷🏻."
- **Owner, 10-06 11:06:** "see what the agent is working on organically and not driven from the agent".
- **Rule implied:** Nothing the system runs is invisible or unattributed. Whatever is working (models, specialists,
  machines, files being edited) can be seen as it happens, and nothing has to be reported by the agent before the
  person can see it. Seeing it is the person's choice ("if you want to"), so it is never forced on them.
- **Where:** §1, as part of what DOCA is. P21 covers only "can be put in front of the person". It should also say the
  view is organic and not chosen by the agent, and that nothing runs unseen.

### A2. Work goes on until it is finished or the person releases it
- **Owner, 10-07 10:47:** "the orchestrator has to manage everything. The user has asked them to do and I have to
  always be working if the projects are not finished. Unless the user tells them that the projects don't need to be
  finished and can be archived or forgotten or deleted."
- **Owner, 10-07 10:47:** "once the notification is open and confirmed from the user or even just opened and read
  than proje Is essentially done if it is actually done unless it requires some intervention from the user, but the
  user can actually respond to, for example, publish it live or anything that you want to respond, delete it for
  example".
- **Rule implied:**
  - A request the person made is carried until it is done.
  - Only the person ends it early: by archiving it, forgetting it or deleting it.
  - "Done" means the result was delivered and the person has opened or read it. The person's answer to that delivery
    (publish it, delete it, change it) is a new instruction that the orchestrator carries out.
- **Where:** §2 (Purpose), next to P15. Today P15 says only "agents stop when done and report only when needed".

### A3. Parallel experts that depend on each other; the result reaches the right device
- **Owner, 10-07 10:47:** "when I for example, ask the orchestrator through the chatter through the call to code an
  entire website and add something they made on blender in the website. He just has to do the logical thing of calling
  to experts start the parallel work and when one is finished and needs the other one just wait for the other one to
  finish and then gets the files that it needed and keeps working and when both are done the orchestrator sends a
  message. The chat if the user has the check open or in the devices or in the device that has asked for the project
  specifically or in all of them."
- **Rule implied:**
  - The orchestrator splits work across specialists that run in parallel.
  - Where one piece of work needs another's output, it waits for it, then takes the files and goes on.
  - When everything is done, one message reaches the person where they are: the open chat, the device that asked, or
    all of their devices.
- **Where:** §1 ("it works like a brain …") or §3 next to P15.

### A4. Stop means stop, visibly; stopped work is offered back
- **Owner, 10-06 18:16:** "We need to make sure that stop means stop maybe with a visible stop. I closed some instances
  which work was already finished, that should not trigger anything since the trigger should have been the job done."
- **Owner, 10-06 19:00:** "We need to be careful to be able to restart if we want to and the agent can tell us that
  some work stopped for some reason and if we want to restart or drop."
- **Rule implied:**
  - A person's Stop ends the work, and the Stop control is visible.
  - Closing finished work never sets anything off.
  - Work that stopped for any reason is reported to the person, who chooses to restart it or drop it.
- **Where:** §4. The mechanism exists in AGENTS.md (2.242, 2.243), but the constitution has no rule for it. Together
  with A2: work persists until done, and the person is the only one who can end it.

### A5. A person's change to their own panel is done, and kept as data rather than code
- **Owner, 10-07 10:47:** "The versatility has to be absolute so that if I ask the the August ready [orchestrator] for
  to change the UI of the the panel itself it just does it as are you request it and it remains a personal change as
  opposed to change to the code base. So this might be something that remains in one of the millions of par meters
  that we can have in the SQL instead of in the code itself … maybe then you can have outdates [updates] for safety but
  without ever removing versatility or functionality."
- **Owner, 10-04 12:22 (same direction, earlier):** "Same solution for every tracking issue, SQL aware of state compared
  to plan, only if possible to automate."
- **Rule implied:**
  - Anything a person asks to change about their own installation is done as asked, including the panel's own look
    and layout.
  - The change is stored as that installation's or person's data (settings or parameters), never as an edit to the
    code base.
  - Releases and safety updates keep these personalisations working and never take a capability away to stay safe.
- **Where:** §0 (it is the other half of "personal choices live in the owner's settings") and P9/P10. The structure for
  it (personal overrides as data that survive updates) is named as a need, not designed; the owner left the design open.

### A6. Secrets are usable without being readable
- **Owner, 10-07 10:47:** "for the APIs or keys or secrets, take 'em leave in the SQL in a safe place and be used but
  not read directly from the agents. … the clipboard can be specific for passwords and be safe to use from Aids
  [agents]. Never based [pasted?] what it is in that tool. … after they the specific number of pastes That they need to
  perform it just gets forgotten … or whatever makes sense to you in this case if you have an alternative."
- **Rule implied:** An agent can use any secret it needs (paste it, send it, log in with it) without ever seeing it. A
  secret handed out for one task is forgotten once the task is over. The clipboard is the owner's example of the need,
  not a specification.
- **Where:** S4. S4 covers "never its value" and "move only when needed", but not use-without-reading as a general
  capability. Read as written, S4 could be taken to mean agents simply cannot use secrets.

### A7. Two ways to deliver it, and set-up by conversation
- **Owner, 10-07 10:47:** "It can be a preseted single machine with no models running inside and ask for all your API
  keys that can be in a VPS, in a Mini PC or logging in to a website. But this can also be something you set up from
  scratch in a powerful setup and let it choose all the latest for previously tested from other users and suggested to
  the project models that can fit and work fine within that specific machine."
- **Owner, 10-07 10:47:** "It can be set up manually with advanced user settings as we are doing now. Or it can just ask
  you what you need in the first setup and when you need something new. It sets it up for you and just waits for you to
  add the APIs if the services are remote … If you prefer to run everything locally and when you ask for something new
  it just asks you which route to go if that actually is a choice. So if the system is not able to Bear that model then
  it will just tell you that he is going to set up a service among the choices that are available from service
  providers and lets you choose based on the offer".
- **Rule implied:**
  - DOCA ships in two shapes:
    - a ready-made appliance with no local models, which asks for keys (on a VPS, a mini PC, or as a website);
    - a from-scratch installation on strong hardware, which picks the models that fit that machine, drawn from the
      models other installations have tested and suggested to the project.
  - Set-up is either manual (advanced settings) or a conversation:
    - It asks what you need, at first set-up and whenever you need something new.
    - It sets things up and waits only for the keys.
    - It asks which route to take only when there really is a choice.
    - When the machine cannot run something, it says so and offers remote providers to choose from.
- **Where:** §1 (what DOCA is) and P4. P4 covers local/remote/standalone/hive, but not the guided set-up, the
  hardware-aware model choice, or the shared "tested by other users" model knowledge. That shared knowledge is the same
  opt-in sharing as §0.4, extended to models.

### A8. Spending money: with the person's permission, not forbidden
- **Owner, 10-07 10:47:** "if you have linked a bank account to it, for example, it will just ask your permission and go
  and set it up."
- **Rule implied:** The product may buy a service for the person when they have connected a way to pay, and only after
  asking each time.
- **Where:** §4. Today the only money rule is W3 ("money … only the admin can provide"). That rule is about developers
  working on the repo. Read across to the product, it would forbid what the owner wants.

### A9. A base experience that feels like magic, and an advanced one
- **Owner, 10-07 10:47:** "What matters now in the project is that it works and the design is a base for the users best
  experience. It can have the base design for non technical users, can seem like magic to them and the advanced one we
  are working on right now."
- **Owner, 10-07 10:47:** "The branding colors and design will come soon."
- **Owner, 10-06 23:46:** "remove the stock color themes except for the dark and clear ones. Rethink the design as many
  times as you want and let those results as alternatives instead in the themes. Be bold, dare, but keep being
  practical, don't omit, reorganize. Keep the actual one and add along."
- **Rule implied:**
  - Two levels of experience on one base: a simple one for non-technical people that feels like magic, and the
    advanced one that exists today.
  - Working comes before final looks. The branding colours are still to come.
  - Bold redesigns are added as themes. The current design is kept, and nothing is left out ("don't omit,
    reorganize").
- **Where:** §7. U6 says only "a new look is an option". The base/advanced split, "don't omit, reorganize" and
  "dark and light kept" are missing.

### A10. When it does not know how: ask once, then keep it
- **Owner, 10-06 15:58:** "Doca can follow the quickest already working route … If the agent doesn't know they learn it
  by asking the first time then execute."
- **Owner, 10-07 10:47:** "it just asks you which route to go if that actually is a choice."
- **Rule implied:**
  - It takes the quickest route that already works.
  - When there is a real choice, or it does not know the person's way, it asks once.
  - Then it acts, and keeps the answer so the next time needs no question.
- **Where:** §0, steps 2–3. Step 3 says "find the best way" but says nothing about asking the person once when the
  choice is theirs.

### A11. One base, two products: general assistant and optimised specialist, every feature kept and known
- **Owner, 10-07 10:47:** "I want this project to be a base for both a general assistant that does everything that track
  of everything that it has learned how to do it through skills so that it repurposes everything in a very quick way
  and a very specific agent that can do specific work reaching on every device or program that it can connect to or
  even just navigating the desks s [desktops] and it has to keep every feature ever coded within it and know about it so
  they know when they have to retrieve them."
- **Owner, 10-07 10:47:** "someone edited for their workflow only and optimized for it. It has to do that job in a very
  optimized way."
- **Rule implied:**
  - Every feature ever built stays in the product, and the agents know it exists and when to bring it back.
  - An edition for one workflow is optimised for that workflow. It is built on the full base, not cut down from it.
- **Where:** §1 (it currently says "what is sold later is a narrower edition"; see B1) and W14 (see B2).

### A12. Reach every device, by any means
- **Owner, 10-07 10:47:** "links all your devices and has reached to all of them through any mean possible so that if
  you want to work on a project in multiple devices or if you have files that you need to retrieve from a specific
  device or you want to install something on another device, you just asked it to do it for you."
- **Owner, 10-06 13:42:** "My question about the connectivity was more about pairing the home devices … smart devices
  that work with Google home or Alexa are a different story".
- **Owner, 10-06 12:12:** "can we pair out of tailscale? Maybe in the local network? Should we limit the users reaches if
  they are not in the tailscale network?"
- **Rule implied:**
  - Reaching a person's devices (computers, phones, smart-home devices) is a goal "through any means possible".
  - That covers working across devices, fetching files from a device and installing software on one.
  - Reach from less trusted networks is allowed but limited.
- **Where:** P12 says only that "a paired client can lend … access". The goal of reaching every device, by any means,
  for any of these purposes belongs in §1 or V2.

### A13. Every output viewable in the panel
- **Owner, 10-04 10:48:** "We should be able to preview all the formats possible when openeing the single files."
- **Owner, 10-06 12:12:** "What do you suggest to visualize the outputs? Directly in the panel? Making it close to
  seamless like the rest of the files or almost".
- **Rule implied:** Whatever the agents produce can be opened and viewed in the panel close to seamlessly, whatever its
  format.
- **Where:** §7 or P21.

### A14. The mission over tokens, and limits only for whoever wants them
- **Owner, 10-06 23:46:** "if the orchestrator remains available, the agent can spend even billions of tokens if they
  need to to complete the missions, actually, I do not care about the tokens, I care about the mission, but I understand
  someone might care about the tokens so notifications and limits can exist".
- **Rule implied:**
  - Finishing the mission comes first.
  - Spend limits and notices exist as settings for people who care about cost.
  - Under §0, the owner's own indifference to cost is his setting, not the product's default.
- **Where:** P20. P20 says "Limits stay at their defaults today". It should add that a limit never silently stops a
  mission the person asked for; it names itself and asks. W12 covers only the developer's own token use.

### A15. Ask the owner broad questions, not menus of choices
- **Owner, 10-07 10:47:** "You can ask me questions in a more broad and philosophical way instead of specific choices.
  The specificity depends on the overall goals. Maybe we need a flowchart that clears out the users experience so that
  it defines what the result needs to be and what specific choices need to be made."
- **Rule implied:**
  - When a decision is the owner's, ask about the goal and the experience, not a list of implementation options.
  - Specific choices follow from the goals.
  - A flowchart of the user experience is the suggested tool for deriving those choices.
- **Where:** §6. It conflicts with C3 as written (see B4).

### A16. Licence and name are not decided yet
- **Owner, 10-04 22:20:** "can we remove the licences, these repos are not actually public, we will decide for the
  licenses once they are in cooked enough as well as the name".
- **Owner, 10-06 20:49:** "the rebranding will happen soon".
- **Rule implied:**
  - No licence files are added until the owner decides.
  - The product name is provisional, which is why every name a person reads goes through the brand file.
- **Where:** P8 or W3 (a licence or name decision is the owner's).

### A17. Client updates are person-proof
- **Owner, 10-06 15:58:** "One question about the wearable, when I want to update after the next time, is it going to be
  user proof or de [developer] oriented?"
- **Owner, 10-05 14:43:** "just update automatically when I knew version is available".
- **Rule implied:** Updating any client (phone, watch, desktop) needs no developer steps. It updates itself, or with one
  tap.
- **Where:** P6 ("upgradable") covers the hub's parts. Clients should be named there too, or in P12.

### A18. Clients stay aligned with the hub
- **Owner, 10-06 13:19:** "Are the clients aligned?"
- **Owner, 10-06 16:40:** "you can now proceed on the apps so they follow correctly".
- **Rule implied:** A hub change that a client should follow is carried into that client's repository in the same piece
  of work, or filed there.
- **Where:** W4/W5. W5 says only "what a sibling app needs goes in that app's own repository".

### A19. Respect what may be borrowed
- **Owner, 10-04 09:28:** "Whatever you know can help the harnbess become as good as yours or compeeting ones (that you
  are allowed to add) you can add."
- **Rule implied:** Take any capability competitors have, but only in a way their licences allow.
- **Where:** V2.

### A20. Archive, never only delete
- **Owner, 10-06 09:15:** "I'd add the opened panels being served, have an archive for all of them also".
- **Owner, 10-07 10:47:** "archived or forgotten or deleted".
- **Rule implied:** What a person puts away (conversations, missions, projects, computers, served panels) goes to an
  archive they can bring it back from. Deleting it is a separate choice, and the person's to make.
- **Where:** §4 or P17 ("a way back, always").

### A21. Smaller points (process, for developers)
- **Owner, 10-06 21:21:** "remember to use the skills such as / design - / engineering:code-review and /
  engineering:system-design". Developer agents should use the review and design skills available to them in audits and
  design work. **Where:** W4/W8.
- **Owner, 10-06 18:07:** "there are some fonts not picked from the UI settings but directly coded into the page." Every
  visual property comes from the theme or settings, never hard-coded in a page. **Where:** U5.
- **Owner, 10-07 08:19:** "blender design was waaaau better with deepseek than the local model, I guess it depends what
  we are testing and how much the speed matters". The model is chosen per task, by the quality the task needs against
  the speed that matters. **Where:** V8 (it names choosing a model, but not this trade-off).

---

## B. CONTRADICTED OR NARROWED

### B1. "A narrower edition" (§1)
- **Constitution §1:** "For now every capability other harnesses have is wanted; what is sold later is a narrower
  edition of it."
- **Owner, 10-07 10:47:** "What the priority remain s that this tool has to be the most versatile possible when it is
  sold. For example, to someone edited for their workflow only and optimized for it." And: "a base for both a general
  assistant … and a very specific agent … it has to keep every feature ever coded within it".
- **Problem:** "For now" and "narrower" read as if the capabilities are temporary and the product is cut down. The owner
  sells both:
  - a general assistant with everything;
  - a focused edition optimised for one workflow, built on the full base.

  The edition is focused in what it shows and how it is tuned, not narrower in what it can reach. (The 10-04 18:18
  wording, "a lower level user with specific skills and selected visible parts", is about what is visible, which agrees
  with this reading.)

### B2. W14 retiring and W9 "graduates or is removed" against "keep every feature ever coded"
- **Constitution W14:** "Archived code leaves main and is kept on an `archive/<name>` tag … the admin answers keep,
  archive or delete."
- **Constitution W9:** "It graduates or it is removed."
- **Owner, 10-06 07:43 (#6):** "maybe archived after it has been replaced and not used for a certain amount of runs?
  Maybe during maintenance the agent could let the user have a list to decide with answers". W14 faithfully carries
  this.
- **Owner, 10-07 10:47 (later, so it wins):** "it has to keep every feature ever coded within it and know about it so
  they know when they have to retrieve them."
- **Problem:** Code that leaves main onto a tag is no longer something the agents "know about". "Delete" as an outcome,
  and W9's "removed", both drop features.
- **Suggested direction:** Keep the owner's list-and-decide step. But an archived feature must stay discoverable by the
  agents (listed where they read it) and retrievable on demand. Whether "delete" stays an option at all is the owner's
  question to answer.

### B3. S1 "the agent proposes, a person decides" against "it just does it as you request it"
- **Constitution S1:** "for whatever governs the agent: settings, installs, plans, schedules, form values (✨ fills a
  draft; only the person's Save writes)."
- **Owner, 10-07 10:47:** "if I ask the … orchestrator … to change the UI of the the panel itself it just does it as are
  you request it and it remains a personal change".
- **Owner, 10-06 05:46 (about the ✨ form helper):** "All the calls modes should be able to do the same, so hands off
  the wheel is fine, checkpoints before edits maybe is a good idea "git" style".
- **Owner, 10-05 17:32:** "If we change the settings or ask the orchestrator to change them for us or just ask the agent
  to do it from it's own agents once instead of as a routine".
- **Constitution A7 itself:** "can be changed by asking in plain words".
- **Problem:** S1 as written makes every setting change a click on a proposal. That includes a change the person
  explicitly asked for, by voice, hands off the wheel. The owner's safety mechanism for these changes is a checkpoint
  (undo), not a second click. S1 contradicts A7 inside the same document.
- **Reading in the owner's spirit (still the owner's call):** A person's own explicit request is the decision for their
  own settings, done with a checkpoint. A click is still needed for:
  - what the agent wants on its own initiative;
  - what widens the agent's own authority (S11's list).

  Note that the recent commit cab82c9 ("a proposal is the question") points the same way.

### B4. C3 "few numbered options" against "broad and philosophical" questions
- **Constitution C3:** "Short, phone-readable answers with a recommendation. Few numbered options, the recommended one
  first; The admin usually answers by number. *Implicit*"
- **Owner, 10-07 10:47:** "You can ask me questions in a more broad and philosophical way instead of specific choices."
- **Owner, 10-06 23:46:** "You can ask me the questions on 1 more directly also."
- **Problem:** Short, phone-readable answers are still right. But decisions should be put to the owner as questions
  about goals and experience, not as menus of implementation choices.

### B5. W3 "money … only the admin can provide"
- **Problem:** This is fine for developers, but it has no product-side counterpart. An agent applying it to the runtime
  would forbid buying a service with the person's permission (A8). The rule should be scoped to developer work, and the
  product rule added.

### B6. P20 "Limits stay at their defaults today"
- **Owner, 10-06 23:46:** "I do not care about the tokens, I care about the mission … notifications and limits can
  exist".
- **Problem:** The current wording freezes the defaults. It should say that limits exist for whoever wants them, and that
  a limit never quietly ends a mission (A14). This is a narrowing risk, not a direct contradiction.

### B7. S5 and §1 values: "speed" last
- **Constitution §1:** "Values, in order when they meet: the person's experience; being right; reaching as far as
  possible while staying safe; openness and cross-compatibility; being future-proof; speed."
- **Owner:** The order is not stated anywhere in this file. Speed is central and repeated:
  - 10-05 17:32: "A structure aiding agents to be quick, efficient"
  - 10-06 20:49: "way quicker because many tools are readily available"
  - 10-07 10:47: "repurposes everything in a very quick way", "do that job in a very optimized way"
- **Problem:** Ranking speed last could be used to justify slow paths. See also C1.

### B8. A2 irony
- **Constitution A2:** "in assistant mode most of all".
- **Owner, 10-06 07:43 (#8):** "only to agent mode more freely".
- **Owner, 10-06 09:15 (later):** "no need to push it, only if it comes natural … only keep the irony in a natural way
  played in the context."
- **Problem:** "Assistant mode most of all" traces to 10-05 22:50 ("maybe even ironic only when necessary"). The later
  09:15 statement wins: natural only, with no mode singled out. This is a small over-reach.

---

## C. ASSUMED: not traceable to any owner message in this file

Many rules cite 2026-09-xx dates, which come from earlier sessions not included here. Those are listed as
*unverifiable here*, not wrong. The ones that look invented or restrictive are flagged.

### C1. The value order (§1)
- No owner message here ranks the values. "Being right" comes from the spoken-assistant context ("Being right comes
  before being quick", A3).
- **Flag:** Likely an agent's synthesis. It is restrictive in that it puts speed last (B7). Ask the owner, or present
  the values as a set rather than a ranking.

### C2. A3 "Act, don't answer" and A4 "Hard requests escalate, and the call stays"
- Both are dated 2026-10-06, but no owner message in this file says them.
- The nearest are:
  - 10-06 15:58: "the agent from Doca just controls the entire device and Doca stays vigilant for the call";
  - 10-05 22:50: "quicker answer and way shorter".
- **Flag:** They may come from an answered question round not captured here. Not restrictive, but check them with the
  owner. In particular, a "✓"-only reply is a product choice.

### C3. S11 "Files that ask first" ("settled 2026-10-06")
- Not stated in any owner message in this file. It is consistent with "safe", but "even inside a loop" governs how
  autonomous work proceeds.
- **Flag:** Unverifiable here. It is safety-tightening, not capability-narrowing, so it is probably fine, but its date
  claims a settlement this file does not show.

### C4. W9 "It graduates or it is removed" and P9 "New routines are off by default"
- The owner said "make sure if the new approaches have pull backs" (10-04 19:09) and "Default routine off" (10-05 17:32,
  about the scout routine specifically).
- "Removed" is an agent's addition and conflicts with 10-07 (B2). Generalising "off by default" to every routine is a
  reasonable extension, but it is an extension.

### C5. C5 level names "Viewer, Member, Admin and Main admin"
- The owner said only "admin?" (10-06 07:43 #4). "Main admin" is invented. Harmless, but not his words.

### C6. S5 "a customer's install never meets the experiments"
- Consistent with 10-05 17:37. Fine.
- Its last clause ("editions are the likely way") is an agent's guess. The owner, 10-06 07:43 #9: "we don't know yet".

### C7. W2 "an agent that cannot reach the hub uses the default"
- Invented detail. Harmless.

### C8. "Not mechanically one function per file" (P7)
- Not the owner's words. Harmless; the owner said "set a limit you see reasonable".

### C9. Unverifiable here (earlier sessions), not flagged as wrong
- V4 (09-14)
- V5 "Autonomy is the aim" (09-26/27)
- P8 (09-25)
- P12 (09-27)
- P14 "rules are there to make it useful, not to hunt conflicts" (09-25)
- S6 quarantine (09-26)
- S7 recovery belongs to the host (09-25)
- W4 (09-26)
- W10 diagnose before fixing (09-11/14)
- C4 (09-26)
- U6 (09-25)

### C10. A note on the header's own claim
- The header says the constitution was "drawn from everything the project's admin asked for … between 2026-09-10 and
  2026-10-06".
- The owner's 10-07 instruction is to "forget all the assumptions that have been made outside of my texts". Every
  *Implicit* rule (W11, W12, C3, C6) is by definition an agent's reading.
- C3 is already contradicted (B4). The others are harmless but should stay marked as readings.

---

## D. SUPERSEDED: later words win

| Earlier | Later (wins) | Constitution today |
|---|---|---|
| 10-06 18:07: "There are references in the empty fields that are not generic but mention me" (asking for generic placeholders) → 10-06 19:00: "Names were a bad call from me, they can go back." | **10-07 09:19:** "we need to treat this project not as personal but as a product, so personal choices are not to be included in the project, only in the settings belonging to the "owner"." | §0 carries the later rule. The user's auto-memory still says "Owner names are fine — don't genericize the owner's name/paths in placeholders, comments, tests (reverted 2026-10-06)", which the 10-07 premise overrides for anything a product user sees. Placeholders, defaults and shipped text are not personal. |
| 10-06 07:43 #8: irony "only to agent mode more freely, generally only when prompted ironically" | **10-06 09:15:** "no need to push it, only if it comes natural … only keep the irony in a natural way" | A2 mostly follows; "assistant mode most of all" is left over (B8). |
| 10-06 07:43 #6: replaced and unused code "archived … the user have a list to decide" | **10-07 10:47:** "keep every feature ever coded within it and know about it" | W14 and W9 follow the earlier statement (B2). |
| 10-04 18:18: "the product sold will probably be a lower level user with specific skills and selected visible parts but for now, we need every capability" | **10-07 10:47:** "base for both a general assistant … and a very specific agent", "most versatile possible when it is sold" | §1 still says "for now … narrower edition" (B1). |
| 10-06 23:46: "remove the stock color themes except for the dark and clear ones … Be bold" | **10-07 10:47:** "The branding colors and design will come soon. What matters now … is that it works" | Not carried at all (A9). Both agree: keep dark and light, add bold alternatives, but working comes first. |
| 10-06 07:43 #9: reseller with admin "we don't know yet, maybe" | No later change | S5 keeps it open. Correct. |
| 10-05 17:32: "Then Doca can ask Claude code to evaluate and implement" | **Same message, a moment later:** "Not necessarily Claude code … it's should be totally able to run that cycle" | P19 follows the later statement. |
| 10-06 19:22: trained wake-word micro model, "You can totally dismiss this if it's overkill" | 10-06 19:28/20:49: the owner offers recordings and keeps the trained word | Built as an experiment; no constitutional rule needed. |

---

## E. The vision in one page: a checklist to hold any change against

**The premise (10-07 09:19).**
- [ ] It is a **product, not my setup**. Nothing personal (a model, a path, a name, a habit) is in the code, the
  defaults, shipped skills or page text. It lives in that owner's settings.
- [ ] **Anyone can ask for anything**, knowing nothing about the system, and it is done within safety for the system and
  the person:
  - their way, if they said how;
  - otherwise the proven way;
  - otherwise the best reliable way, found and saved so the next time is quick;
  - suggested onward only if the owner allows sharing.
- [ ] When it does not know the person's way, or the choice is genuinely theirs, it **asks once**, then acts and keeps
  the answer.

**What it is (10-07 10:47, 10-06 20:49, 10-05 17:32).**
- [ ] OpenClaw + OpenDots, with a UI where you **see everything that is happening, if you want to**. Seeing is organic,
  not narrated by the agent, and nothing runs unseen or unattributed.
- [ ] **Almost Jarvis on any open state-of-the-art model.** The structure lets much weaker models do frontier work,
  quicker, because the tools are ready. It is the skeleton for every tool harvested in the field, refined until the
  output "has some dignity".
- [ ] **Like a brain.** The person talks, the orchestrator directs, and the panel alone picks skills, tools, specialists,
  devices and models (by what the task needs: quality against speed). Every part has its function.
- [ ] **Reaches every device by any means**: computers, phones, watches, smart-home devices, desktops it navigates. Work
  across devices, fetch files from any device, install on any device, just by asking.
- [ ] **Local, remote or mixed; standalone or hive; any OS; any network; server, VM, VPS or website.**
  - Two shapes: a ready appliance that asks for keys, or a from-scratch install that picks the models that fit the
    machine, informed by models other users tested.
  - Set up manually, or by conversation: it asks what you need, sets it up, waits only for keys, and offers providers
    when the machine cannot carry it.
- [ ] May **buy a service with the person's permission** when they have connected a way to pay.

**How work runs.**
- [ ] The orchestrator stays free to talk.
- [ ] It sends experts in parallel. Dependent work waits for its input, then continues.
- [ ] One message lands where the person is: the open chat, the device that asked, or all devices.
- [ ] **Work persists until finished.** It is done when delivered and opened or read. The person's reply (publish,
  delete, change) is the next instruction. Only the person can archive, forget or delete unfinished work.
- [ ] **Stop means stop, visibly.** Closing finished work triggers nothing. Stopped work is reported, with restart or
  drop.
- [ ] Risky or UI work runs on agents' own temporary machines, and they report when the requirements are met.
- [ ] **Mission over tokens.** Limits and notices exist for whoever wants them, name themselves, and never silently end a
  mission.

**Versatility is absolute.**
- [ ] **Keep every feature ever coded, and the agents know about it** and when to retrieve it. Nothing is lost by
  retiring.
- [ ] A person's request to change their own panel (UI included) **is done as asked**. It is stored as their data, not
  as a code change, and survives every update.
- [ ] Safety updates **never remove versatility or functionality**. The safety comes from checkpoints, isolation and a
  way back.
- [ ] One base, two products: a **general assistant** that learns skills and repurposes them quickly, and an **edition
  optimised for one workflow**. Both carry the whole base.
- [ ] Any service can be added without changing code: paste a key, or let the agent draft it.
- [ ] Every capability other harnesses have, taken only as their licences allow.
- [ ] Everything open, interchangeable and cross-compatible: assets import and export in other tools' formats.

**Safety.**
- [ ] Secrets are **used, never read**, by agents, and forgotten when the task is done.
- [ ] The agent acts at its person's level.
- [ ] Bulk approval is explicit.
- [ ] Snapshot before anything risky. Nothing restarts while something runs. Never restore onto live data.

**Experience.**
- [ ] A **base experience that feels like magic** for non-technical people, and the advanced one. Working comes first;
  branding comes later.
- [ ] Dark and light themes are kept. Bold redesigns are added as themes; don't omit, reorganise.
- [ ] Phones are first-class. Every output is viewable in the panel. protolab.tech quality ("4K, not 480p").
- [ ] Voice:
  - a chat call;
  - an assistant mode that is quick, short and Jarvis-like, and controls devices and buildings;
  - only words count;
  - the microphone is on only when needed;
  - settings can be changed by asking.

**Working with the owner (developers).**
- [ ] Read for intent (phone, speech-to-text).
- [ ] Correct him and check names.
- [ ] Ask **broad, philosophical questions about goals**, not menus. Decide what the principles answer.
- [ ] Do not assume beyond his texts.
