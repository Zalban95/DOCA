# 2026-10-07 — a test wrote the live settings

**What happened.** `test/claims.test.js` (claimCheck, 2.264.0 branch) required `modules/harness/turn/claims` before
`test/helpers.js`. Its unit tests loaded `experiments` → `settings-schema` → `utils` → `paths`, and `paths.js` fixes
`PREFS_FILE` and `CONFIG_PATH` when it is first required — so they held the real ones. The end-to-end test then ran,
from the main checkout, with the real paths:

- the hub's prefs (`.dashboard-prefs.json`, the live panel's): `harness.config.doca` provider/model set to a stub
  (`cstub`/`m`), `fallbackChain: []`, `summarizeAfter: 0`; `developer.mode` (already on) and `experiments.claimCheck`
  written;
- `~/.openclaw/openclaw.json` overwritten with one stub provider (it holds the providers DOCA and OpenClaw use).

The live harness could not answer from about 09:20 to 09:50 (no turn was running; `/api/harness/busy` empty). Data
(memory, conversations) was not touched: those paths resolve lazily and went to the test's temp folder. CI caught it
the other way round — its default prefs have developer mode off, so the test failed there.

**Repaired.** `openclaw.json` from its `.bak` (2026-09-14, the newest copy anywhere; the clobbered file is kept in the
session's scratch folder). The four harness fields from the evaluation sandbox's untouched copy of the prefs taken at
08:57 (`/tmp/doca-eval-*/prefs.json`, the parent's: a child's has its `--models` override) — every other key compared
equal; `experiments.claimCheck` removed. A live turn answered on DeepSeek4f / deepseek-flash afterwards.
What may be lost: any change to `openclaw.json` made after 2026-09-14 (none is known; nothing in DOCA wrote it since).

**So it cannot happen silently again.** `test/helpers.js` refuses to load when `modules/paths.js` is already loaded
(it would hold the real paths) — which also caught `test/shell.test.js` doing the same, harmlessly so far. A full
`npm test` leaves the real prefs and `openclaw.json` byte-identical (checked by hash).
