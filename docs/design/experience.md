# The experience — what a person meets, and what each step must produce

Written 2026-10-07 from the owner's description of the product (CONSTITUTION §0). It defines **results**, not
screens: what a person must have at each step, where a real choice exists, and where the system decides for them.
Design and branding come later and build on this; nothing here picks a look.

Two people use the same product:

- **Someone who knows nothing** — it should feel like magic. They say what they want; it happens, or they are asked
  the one thing only they can answer.
- **Someone who wants to see and steer everything** — every setting, every agent, every device, every log (the panel
  as it is being built now).

They are not two products and not two code paths: the second sees the machinery the first never has to. Anything the
advanced view can do, the simple view can ask for in words.

## 1. Getting DOCA

```mermaid
flowchart TD
  A[Someone wants DOCA] --> B{How do they get it?}
  B -->|Sign in to a website| W[A hosted hub, theirs]
  B -->|A small machine: VPS, mini PC| P[A preset hub, no local models]
  B -->|Their own powerful machine| L[A full hub that can run models itself]
  W --> K[Asks for the API keys it needs, as it needs them]
  P --> K
  L --> M[Looks at the machine: GPUs, memory, disk]
  M --> N[Picks, from models other installs tested and the project suggests, the newest that run well here]
  N --> O[Installs and checks them; the person waits, or watches]
  K --> S
  O --> S[Ready: one conversation, nothing else to configure]
  S --> T{Did they choose the guided or the advanced setup?}
  T -->|Guided| G[It asks what they need, in plain words, and sets up only that]
  T -->|Advanced| V[Every setting, as today]
```

**Results that must hold.** A first conversation works within minutes on any of the three. The person is never asked
something the machine can find out. A hub that can run nothing locally still does everything, through providers.
Exists today: the installers, the panel's first-run owner, models and services catalogues, provider keys. Missing:
the hosted sign-in offering; "pick the right models for this machine from what others tested" (the model scout looks,
but nothing collects other installs' results); a guided first setup.

## 2. Asking for anything

```mermaid
flowchart TD
  R[The person asks, by text, voice, phone, watch, or a device] --> H{Did they say how?}
  H -->|Yes| Y[Do it their way]
  H -->|No| PR{Is there a proven way here?}
  PR -->|A recipe| RC[Run it: no new reasoning]
  PR -->|A skill or a specialist| SK[Follow it]
  PR -->|No| F[Find the best way that can become reliable]
  F --> NEED{Does it need something missing?}
  NEED -->|A local service the machine can bear| IN[Propose it; install on a click]
  NEED -->|Too heavy for this machine| PV[Offer providers' options to choose from]
  PV --> PAY{Is a payment method linked?}
  PAY -->|Yes| PERM[Ask permission once; then set it up]
  PAY -->|No| KEY[Say what it costs and where; wait for the key]
  NEED -->|An API key| KEY
  NEED -->|Nothing| DO[Do it]
  IN --> DO
  PERM --> DO
  KEY --> DO
  Y --> DONE
  RC --> DONE
  SK --> DONE
  DO --> KEEP[It worked: keep it as a recipe, a skill or a specialist]
  KEEP --> SHARE{Does the owner share what is learned?}
  SHARE -->|Yes| OFF[Offered to the project, on the owner's click]
  SHARE -->|No| DONE
  OFF --> DONE[Answer where they asked, and on their devices if it mattered]
```

**Results that must hold.** The person never has to know what DOCA is made of. A real choice (money, something
outward or irreversible, taste) is asked once, with options; everything else is decided. Safety limits hold for the
system and for the person (the charter's Safety section; what cannot be undone is said in those words).
Exists today: the ladder in the charter and routing table (2.271.0), recipes, skills, specialists, install and
settings proposals, keys for services, `api_call`, the newcomer and routing evaluation sets. Missing: offering
providers' options when the machine cannot bear a model; spending with a linked payment method (none is linked —
needs its own safety design before anything is built).

## 3. A project, from request to done

```mermaid
flowchart TD
  Q[The person asks for a project: a website with a Blender model in it] --> OR[The Orchestrator plans: which experts, in what order, what each needs from the other]
  OR --> E1[Expert 1: the website, in its own work chat or computer]
  OR --> E2[Expert 2: the 3D model, on the machine with Blender]
  E1 -->|needs the model| WAIT[Waits for Expert 2's files, keeps doing what it can]
  E2 --> FILES[Hands its files over]
  FILES --> WAIT
  WAIT --> E1D[Website done, model in it]
  E1D --> TEST[Tested in its own temporary computer until the requirements hold]
  TEST --> MSG[The Orchestrator tells the person: in the chat if open, on the device that asked, or on all]
  MSG --> READ{The person opens it}
  READ -->|Read or confirmed, nothing else needed| FIN[Done]
  READ -->|Needs them: publish, delete, choose| ACT[They answer; the Orchestrator carries it out]
  ACT --> MSG
  MSG -.->|Not finished| OR
```

**Results that must hold.** Work that is not finished keeps going until it is, or until the person says to archive,
forget or delete it — the Orchestrator never drops a project silently. The person can watch everything happening, or
nothing. Exists today: work chats, specialists, missions, computers for agents, plans, stopped-work and restart/drop,
devices told on start/finish, archive. Missing: experts waiting on each other's files (a dependency between missions);
"read = done" as an explicit state; the Orchestrator returning to unfinished projects on its own after a restart (it
asks today).

## 4. Every device is reachable

The person works on one project from several devices, fetches a file from one, installs something on another — by
asking. Exists: phone, watch, desktop and the node client as MCP hosts, the browser extension, files across devices,
pairing, device pages. Missing: install on another device by asking (the shell is there; a skill and a safe flow are
not).

## 5. Versatility: a personal change is data, not code

When someone asks the Orchestrator to change the panel itself — a layout, a page, a colour, a new button — that is
**their** change: it lives in their install's data, layered over the shipped defaults, and survives every update.
The code base changes only when the project changes.

```mermaid
flowchart LR
  CODE[Shipped defaults: code] --> ED[Edition: a pack]
  ED --> HIVE[This install: the owner's settings]
  HIVE --> PER[A person]
  PER --> DEV[A device or screen]
  DEV --> SEEN[What is shown and done]
```

Exists: this layering for settings (`settings-schema.js`, screens, editions). Missing: the panel's own structure as
data — pages, layouts, custom views — so the agent's "change the UI" edits that layer, not the repository. An update
may add safety; it never removes something a person had.

## 6. Secrets: usable, never readable

An agent uses a password, a token or a key without ever seeing it. Exists: provider keys and keys for services
(the hub adds them to requests), logins typed into a computer's browser by a hidden tool, masking everywhere.
Missing: the same on any device — a secret handed to a device's input for a set number of pastes and then forgotten,
never readable by the agent (a "sealed clipboard"), as the general form of what `computer_login` does for one
browser.

## Questions for the owner

Broad ones, because the specifics follow from them:

1. **Who is the first customer?** The person who knows nothing, or the person who wants to see everything? Both are
   kept; the first decides what "done" looks like for the next months.
2. **How much may DOCA spend on its own?** With a payment method linked, is there an amount below which it acts and
   tells, above which it asks — or is every spend asked?
3. **How far may it reach into a device unasked?** Installing on another device, reading its files, driving its
   screen: asked once per kind of action and remembered, or asked each time?
4. **What does "finished" mean for an open-ended project?** A website is never finished; when does the Orchestrator
   stop working on its own and wait to be asked?
5. **Whose is a personal change when the person leaves?** A change one person made to the panel: theirs only, the
   install's, or offered to everyone on it?
