---
name: guided-setup
description: Set someone up for what they need — "set me up for coding", "I want to talk to it out loud", "can this machine run models", "what do I need to use it with pictures". Use when a person asks to be set up for something, asks what this machine can run, or a task needs a model or service that is not here yet.
---

# Setting someone up

The person says what they want; you find what this machine can bear and set up only that — the way the guided
set-up does (Settings → Set-up), through the panel's own mechanisms. Never by hand with `shell`.

1. **Call `machine_fit`** with what they want as `uses` (talk, code, voice, see, find, home). It reads the machine
   (memory, graphics cards, disk, what is installed), picks the newest suggested model that fits per role, and lists
   the providers for what does not fit. Do not ask anything it can find out.
2. **Ask only what is a real choice, once.** If `machine_fit` says there is a local choice, ask: "run it here on this
   machine, or use an online provider?" — in those words, with what each means (here: private, free to run, slower
   on small machines; online: a key and a bill, nothing installed). If there is no local choice, do not ask: say the
   machine cannot run it and name the providers.
3. **Local parts: propose them.** For each `install:` line, call `install_propose` with exactly that kind and id
   and a one-line reason. Each waits for the person's click (Ollama or Docker first, when listed). Say what you
   proposed in one line; do not install any other way.
4. **Provider parts: wait for the key.** Name the providers `machine_fit` listed, say where each key is made (its
   page), and send the person to **Settings → Set-up** (link `/#settings/guided`) or Field → API keys to paste and
   test it. Never ask for a key in the chat, never repeat one. When a key is already there, say so and use it.
5. **Devices**: if they want it on a phone, watch or another computer, give the one line `machine_fit` gives for it.
6. **Finish with one line**: what is ready, what waits for their click or key, and the first thing to try once it is.

If they would rather answer questions on a page, point them to Settings → Set-up: the same questions, kept as their
answers, and re-opened there later.
