#!/usr/bin/env node
'use strict';

/**
 * npm run db-bench — the data layer's engines judged by numbers
 * (docs/design/database.md: "faster engines are considered only if they speak
 * the Postgres protocol — then they drop in with no code change, and
 * `npm run db-bench` judges them").
 *
 * The workloads are DOCA's own shapes, through the layer's own calls:
 *   append     one INSERT per call, like the usage ledger and the audit log
 *   batch      many INSERTs in one transaction, like an import
 *   point      a row by primary key
 *   aggregate  SUM … GROUP BY over the appended rows, like usage by day
 *   doc        upsert then read a ~4 KB JSON document, like a session's index row
 *   parallel   point reads, 8 at a time (a pool matters here; SQLite is in-process)
 *
 * Safe to point anywhere, and still best pointed at a scratch database: it
 * never runs DOCA's migrations, and it touches only tables named bench_*,
 * which it creates and drops. Without DOCA_DB_URL it uses SQLite in a temp
 * directory, never the real doca.db.
 *
 *   npm run db-bench                       SQLite (node:sqlite), temp file
 *   DOCA_DB_URL=postgres://… npm run db-bench
 *   npm run db-bench -- --n 5000 --json
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const N = Math.max(10, Number(opt('--n')) || 2000);
const JSON_OUT = args.includes('--json');

function stats(name, times, totalMs) {
  const s = [...times].sort((a, b) => a - b);
  const q = f => s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0;
  return { op: name, count: times.length, totalMs: +totalMs.toFixed(1),
    opsPerSec: Math.round(times.length / (totalMs / 1000)), p50us: Math.round(q(0.5) * 1000), p95us: Math.round(q(0.95) * 1000) };
}

async function timed(name, count, fn) {
  const times = [];
  const t0 = performance.now();
  for (let i = 0; i < count; i++) { const t = performance.now(); await fn(i); times.push(performance.now() - t); }
  return stats(name, times, performance.now() - t0);
}

async function bench({ url, n = N } = {}) {
  let tmp = null;
  if (!url) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-db-bench-'));
    process.env.DOCA_DATA_DIR = tmp;
    // store.js reads DOCA_DATA_DIR once; a fresh require sees the temp one.
    for (const k of Object.keys(require.cache)) if (/modules[\\/](store|db[\\/])/.test(k)) delete require.cache[k];
  }
  const d = require('../modules/db').openBare(url);
  const results = [];
  try {
    await d.exec('DROP TABLE IF EXISTS bench_rows');
    await d.exec('DROP TABLE IF EXISTS bench_docs');
    await d.exec('CREATE TABLE bench_rows (id INTEGER PRIMARY KEY, day TEXT NOT NULL, model TEXT NOT NULL, tokens INTEGER NOT NULL)');
    await d.exec('CREATE TABLE bench_docs (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    const day = i => `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`;

    results.push(await timed('append', n, i => d.run('INSERT INTO bench_rows (id, day, model, tokens) VALUES (?, ?, ?, ?)', [i, day(i), `m${i % 5}`, i % 4000])));
    const t0 = performance.now();
    await d.tx(async q => { for (let i = n; i < 2 * n; i++) await q.run('INSERT INTO bench_rows (id, day, model, tokens) VALUES (?, ?, ?, ?)', [i, day(i), `m${i % 5}`, i % 4000]); });
    const batchMs = performance.now() - t0;
    results.push({ ...stats('batch', [], batchMs), count: n, opsPerSec: Math.round(n / (batchMs / 1000)), p50us: null, p95us: null });
    results.push(await timed('point', n, i => d.get('SELECT * FROM bench_rows WHERE id = ?', [(i * 7919) % (2 * n)])));
    results.push(await timed('aggregate', Math.max(5, Math.floor(n / 100)), () => d.all('SELECT day, model, SUM(tokens) AS t FROM bench_rows GROUP BY day, model')));
    const body = JSON.stringify({ title: 'x'.repeat(200), rows: Array.from({ length: 60 }, (_, i) => ({ i, text: 'y'.repeat(50) })) });
    results.push(await timed('doc', n, async i => {
      await d.run('INSERT INTO bench_docs (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body', [`s${i % 50}`, body]);
      await d.get('SELECT body FROM bench_docs WHERE id = ?', [`s${i % 50}`]);
    }));
    const pTimes = [];
    const p0 = performance.now();
    for (let i = 0; i < n; i += 8) {
      await Promise.all(Array.from({ length: 8 }, async (_, j) => {
        const t = performance.now(); await d.get('SELECT * FROM bench_rows WHERE id = ?', [(i + j) % (2 * n)]); pTimes.push(performance.now() - t);
      }));
    }
    results.push(stats('parallel', pTimes, performance.now() - p0));
  } finally {
    try { await d.exec('DROP TABLE IF EXISTS bench_rows'); await d.exec('DROP TABLE IF EXISTS bench_docs'); } catch { /* best effort */ }
    await d.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { engine: d.kind, where: url ? d.url : 'temp file', n, node: process.version, results };
}

function table(r) {
  const head = ['op', 'count', 'total ms', 'ops/s', 'p50 µs', 'p95 µs'];
  const rows = r.results.map(x => [x.op, x.count, x.totalMs, x.opsPerSec, x.p50us ?? '—', x.p95us ?? '—'].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(row => row[i].length)));
  const line = row => row.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ');
  return [`${r.engine} (${r.where}), n=${r.n}, node ${r.node}`, line(head), ...rows.map(line)].join('\n');
}

if (require.main === module) {
  bench({ url: process.env.DOCA_DB_URL })
    .then(r => { console.log(JSON_OUT ? JSON.stringify(r, null, 2) : table(r)); })
    .catch(e => { console.error(`db-bench: ${e.message}`); process.exit(1); });
}

module.exports = { bench, table };
