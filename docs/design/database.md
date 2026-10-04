# State in a database

Decided with Al, 2026-09-27: **PostgreSQL is the long-term target** (hosting on a
VPS, login-bound sites for companies or individuals, many tenants), **SQLite for
a single install** (nothing to run, one file, backups stay simple), and **one
data layer** in front of both so the same code runs either way. Faster engines
are considered only if they speak the Postgres protocol — then they drop in with
no code change, and `npm run db-bench` judges them by numbers.

## Why PostgreSQL for hosting

- Every VPS host and managed service offers it; company IT already runs it.
- **Row-level security**: one database serves many tenants, each sees only its
  own rows, enforced by the database rather than by every query remembering to.
- JSONB for the flexible records DOCA keeps; full-text search for recalling
  conversations; `pgvector` for the retrieval layer when keyword search stops
  being enough.

## The layer (`modules/db/`)

One small interface, two backends, chosen by `DOCA_DB_URL`:

| `DOCA_DB_URL` | Backend | Where |
|---|---|---|
| unset | SQLite, `node:sqlite` (built into Node 22; no dependency) | `<DATA_DIR>/doca.db` |
| `postgres://…` | PostgreSQL via `pg` (installed when used) | the server named |

- `db.run(sql, params)`, `db.all(sql, params)`, `db.get(sql, params)`,
  `db.tx(fn)` — SQL written once in the common subset of both dialects, with `?`
  placeholders (rewritten to `$1…` for Postgres).
- Migrations are numbered, in `modules/db/migrations.js`; each runs once and is
  recorded in `schema_migrations`.
- Every table has `tenant_id` (default `'local'`), so a hosted database adds
  row-level security without a schema change.
- The SQLite file is opened in WAL mode; a backup takes a consistent copy with
  `VACUUM INTO` instead of copying the live file (`backup/archive.js`).

## What moves, in order

1. **Append-only logs — done first, lowest risk:** the usage ledger
   (`harness/usage.js`) and the auth audit log (`auth/store.js`). On first open
   the existing JSONL files are imported once; they stay on disk, readable.
2. **Done in 2.111.0:** sessions (the index and every transcript) and memory, as
   documents and lines (`db/docs.js`), read and written synchronously on SQLite so
   the ~100 places that read them did not change. Full-text search for
   `recall_conversations` is the next use of it.
3. Missions, proposals, devices, then the rest.

## Judging an engine: `npm run db-bench`

`bin/doca-db-bench.js` runs DOCA's own shapes through the layer's own calls —
single appends (the ledger), one big transaction (an import), point reads, a
`GROUP BY` aggregate (usage by day), JSON-document upserts (a session row), and
point reads eight at a time — and prints ops/s with p50/p95 per workload
(`--json` for a machine, `--n` for size). It opens the backend bare
(`db.openBare`): no migrations, only `bench_*` tables it creates and drops, and
without `DOCA_DB_URL` a temp SQLite file rather than `doca.db`. Still, point it
at a scratch database. Measured 2026-10-04 on the office desk, SQLite, n=2000:
appends ~160k/s, point reads ~250k/s, aggregate ~1.5k/s — the numbers any
server engine has to beat over a socket to be worth running.

The JSON/JSONL files remain the **export** format (and what an older version can
read), never the other way round.

## Tenancy

- **A machine per customer** (VM or container): SQLite, or a Postgres beside it.
- **A shared site**: one Postgres, `tenant_id` on every row, row-level security
  per tenant, the tenant set per connection.
