# TODO-CAMPAIGN — merged back into TODO.md

This was a working copy of `TODO.md`, taken when the troubleshooting campaign
started so the list could be annotated while the campaign ran. It is no longer
a second source of truth: **`TODO.md` is the list**, and everything that was
only here is now there.

What came back on 2026-09-18, when `dev/troubleshoot` merged into `main`:

- The measured answer on tool-schema caching — the premise was false, the table
  and the lesson — replaced the open question `TODO.md` still carried.
- The old "the ledger is per turn and is not kept" entry was dropped, because
  the ledger was built in the meantime and `TODO.md` carries what is left of it
  (no page, no prices, gateway harnesses uncounted).
- Nothing else differed: `TODO.md` already held every other entry, plus the ones
  written while the campaign ran (markdown rendering, a mission's plan,
  authentication, users and groups, the orchestrator's job).

`CAMPAIGN.md` keeps the campaign itself — the wave tables, what closed and what
is blocked on a human decision. The line numbers in it point at the snapshot
this file held, which stays readable in git history; `TODO.md` has moved on
since, so match entries by their title rather than by line.

The campaign's rule "do not edit `TODO.md`" ends here. A campaign that annotates
a frozen copy cannot receive entries written meanwhile, and both files drifted
within a day — the annotations belong on the live list, and the status belongs
in `CAMPAIGN.md`.
