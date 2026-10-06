---
name: doca-dev-cycle
description: Implement a change on DOCA or one of its apps (DocaDesk, DocaMobile, DocaWear) from a TODO line to a release — branch, build, test, commit, then merge, tag and push (asking first unless the admin's Releasing setting lists your model). Use for a scout suggestion or any TODO item.
---

# From a TODO line to a release

The repository's `CONSTITUTION.md` is the law and `AGENTS.md` how it is carried out; read both first, and the sibling
app's `AGENTS.md` when you touch one. This is the cycle every change follows, in order.

1. **Look before you touch.** `git status` in the repository. What is already modified or untracked is someone else's
   work: do not stash, reset or commit it. Never pop a stash you did not just create. Before anything risky (a
   reset, a rebase, a force-push, deleting files or data) make the way back first — a `snapshot/<date>-<what>` tag, a
   copy — and say where it is (CONSTITUTION S9). A change to a file CONSTITUTION S11 lists that widens what an agent
   may do waits for a person's yes.
2. **A branch of its own**, from the default branch (`main`; DocaDesk's is `master`): `git checkout -b <short-name>`.
3. **The change, the way DOCA grows:**
   - **Interchangeable**: a new model is a setting's value or a catalog row (Services, System tools, a reader in
     `modules/vision`, a harness in `catalog.js`) beside the old one, never a replacement that removes the old way;
     compare the market and write the comparison down. An old way leaves only by a person's choice (CONSTITUTION W14).
   - **Local or remote**: whatever runs on this machine should also be reachable at an address, and the reverse.
   - **Any OS**: commands by argv, Linux, macOS and Windows alike (`shell.js`, `system-tools-catalog.js` per OS).
   - **New and uncertain is an experiment**: a row in `modules/experiments.js`, a write-up in
     `docs/experiments/<id>.md` (hypothesis, what is measured, cost, risks, rollback) and a measurement in
     `bin/experiments/<id>.js`. Experiments need developer mode.
   - **Safe**: a secret goes in a secret-named setting or the keys folder, never in a repository or a message; a new
     panel route gets a row in `modules/auth/rights.js` and in `modules/api-v1/coverage.js`; a new prefs key is
     declared in `modules/settings-schema.js`.
   - **Shape**: one idea per file, new files aiming at 250 lines (400 is the tested ceiling), front-end globals unique.
4. **Check it.** `npm test` must be green — say what it printed. A front-end change: `npm run smoke` (set `CHROME` to a
   Chromium if none is found) and the page looked at. An app: its Gradle build and unit tests (`sh gradlew
   testDebugUnitTest assembleDebug`), checking the exit code, never only a filtered log.
5. **Commit**: one logical change per commit, the message says why. A move and a behaviour change are two commits.
6. **The release** — ask before each of these, through an approval or a plain question, unless your model is one the
   admin lets release unasked (your environment's "releasing DOCA" line says which you are; Settings → Developer → Releasing;
   CONSTITUTION W2):
   - the version in `package.json` (patch for a fix, minor for behaviour), `npm run openapi:write`, a commit
     `[X.Y.Z] …`;
   - push the branch and wait for CI on Linux, Windows and macOS (`gh run watch`);
   - merge into the default branch, an annotated tag `git tag -a vX.Y.Z -m "…"`, push both;
   - the live panel switched to the tag (Settings → General → Updates) — the switch waits for running turns and
     calls; never force it over someone's work — and the change looked at there.
7. **Close the loop**: check the change's logic against the rest of the project and the docs that describe it, tick the TODO line, and say what you ran, what it printed, and what you did not check.
