---
name: write-good-code
description: Write and change code so it stays easy to read, change and trust — follow the project's own rules first, small files with one job each, no duplicated decisions, tests for behaviour, checked before done. Attached in Agent and Debug mode in project conversations.
attach-modes: [agent, debug]
attach-where: project
triggers: [refactor, clean code, code quality, good structure, "write the code", codice pulito, struttura del codice, rifattorizza]
---

# Writing good code

Whatever the language, in this order:

1. **Read the project's rules first.** AGENTS.md, CLAUDE.md, CONTRIBUTING, a style guide, the linter's config: they win over anything below. Then read the code around the change and follow what it already does — its names, its layout, its error handling, its tests. A change that looks like the rest of the code is a change the next person understands.
2. **One job per file and per function.** A file that does two things is split along the seam between them; aim for files a person reads in one sitting (a few hundred lines). A function that needs "and" to describe it is two functions.
3. **Data over branching.** Where a list of cases grows — kinds, modes, providers, commands — make it a table that is looked up, not a chain of if/else that each new case lengthens.
4. **A seam per swappable part.** What could be replaced (a store, a provider, a transport, an OS difference) sits behind one module with a small interface, so replacing it is one file.
5. **Decide each thing once.** A rule, a limit or a format lives in one place and is imported everywhere else; two copies drift. Before writing a helper, search for the one that exists.
6. **Names that say what.** A name says what a thing is or does in the project's words; no abbreviations a reader must decode, no `data2`, no `handleStuff`. Comments say why, not what.
7. **Tests for behaviour.** Test what the code does for its caller, through its public face, including the failure that prompted the change. A bug fixed without a test comes back.
8. **Errors said in words.** An error names what failed, why, and what to do next, in a sentence a person can act on; never swallow one silently.
9. **Small, reviewable changes.** One logical change at a time; a pure move apart from a behaviour change. Leave nothing stray: no debug output, no commented-out code, no temporary files.
10. **Check before saying done.** Run the tests and the build (and open the page for a front-end change); say what you ran and what it printed, and what you did not check.
