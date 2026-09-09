'use strict';

/**
 * Surface registry and snapshot builder.
 *
 * A surface is a named, scoped group of typed metrics (and/or list items)
 * with the commands that apply to it. Definitions are derived from the
 * platform's existing registries; values come from the shared sampler.
 *
 * Units are a closed enum; `display` is always present so a client that
 * knows nothing about units can still print the value.
 */
const { INFERENCE_SERVICES } = require('../services');
const sampler = require('./sampler');
const L = require('./limits');

const UNITS = ['%', '°C', 'B', 'B/s', 's', 'MHz', 'W', 'count', ''];
const KINDS = ['gauge', 'counter', 'rate', 'duration', 'timestamp', 'text', 'enum', 'boolean', 'bytes', 'vector'];

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (b == null || !Number.isFinite(b)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
function fmtDuration(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
function display(kind, unit, value) {
  if (value == null) return '—';
  switch (kind) {
    case 'bytes':    return fmtBytes(value);
    case 'rate':     return unit === 'B/s' ? `${fmtBytes(value)}/s` : `${value} ${unit}`.trim();
    case 'duration': return fmtDuration(value);
    case 'boolean':  return value ? 'yes' : 'no';
    case 'vector':   return Array.isArray(value) ? `${value.length} values` : '—';
    case 'text': case 'enum': case 'timestamp': return String(value);
    default: {
      const n = typeof value === 'number' ? (Number.isInteger(value) ? value : Math.round(value * 100) / 100) : value;
      return unit === '%' || unit === '°C' ? `${n}${unit}` : `${n} ${unit}`.trim();
    }
  }
}

// ─── Metric / item constructors ──────────────────────────────────────────────

const T_PCT   = [{ level: 'warn', gte: 70 }, { level: 'crit', gte: 90 }];
const T_MEM   = [{ level: 'warn', gte: 80 }, { level: 'crit', gte: 95 }];
const T_TEMP  = [{ level: 'warn', gte: 80 }, { level: 'crit', gte: 90 }];

/** Build a metric object; `ctx` carries observedAt/ttlSec/stale and the spark opt-in. */
function metric(ctx, def, value, extra = {}) {
  const m = {
    id: def.id, label: def.label, kind: def.kind, unit: def.unit ?? '',
    value: value === undefined ? null : value,
    display: display(def.kind, def.unit ?? '', value),
    observedAt: ctx.observedAt, ttlSec: ctx.ttlSec, stale: !!ctx.stale,
  };
  if (def.min != null) m.min = def.min;
  if (def.max != null) m.max = def.max;
  if (extra.max != null) m.max = extra.max;
  if (def.thresholds) m.thresholds = def.thresholds;
  if (def.values) m.values = def.values;             // enum vocabulary
  if (ctx.spark && def.spark !== false && ['gauge', 'rate', 'bytes'].includes(def.kind)) {
    const s = sampler.spark(def.id, ctx.sparkPoints);
    if (s.length > 1) m.spark = s;
  }
  return m;
}

const STATES = ['running', 'stopped', 'paused', 'error', 'starting', 'unknown'];
function itemState(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('running') || s.startsWith('up')) return 'running';
  if (s.includes('paused')) return 'paused';
  if (s.includes('restarting') || s.includes('created')) return 'starting';
  if (s.includes('exited') || s.includes('dead') || s.includes('stopped')) return 'stopped';
  if (s.includes('error') || s.includes('unhealthy')) return 'error';
  return 'unknown';
}

// ─── Surface definitions ─────────────────────────────────────────────────────

/** Static definitions; gpu.N surfaces are appended from the live sample. */
const DEFS = {
  'system.cpu': {
    title: 'CPU', kind: 'metrics', refreshHintSec: 5, group: 'system',
    metrics: [
      { id: 'system.cpu.pct',   label: 'CPU',   kind: 'gauge', unit: '%',   min: 0, max: 100, thresholds: T_PCT },
      { id: 'system.cpu.temp',  label: 'Temp',  kind: 'gauge', unit: '°C',  min: 0, max: 110, thresholds: T_TEMP },
      { id: 'system.cpu.freq',  label: 'Freq',  kind: 'gauge', unit: 'MHz' },
      { id: 'system.cpu.cores', label: 'Cores', kind: 'vector', unit: '%', min: 0, max: 100, spark: false },
      { id: 'system.load.1',    label: 'Load 1m',  kind: 'gauge', unit: '' },
      { id: 'system.load.5',    label: 'Load 5m',  kind: 'gauge', unit: '' },
      { id: 'system.load.15',   label: 'Load 15m', kind: 'gauge', unit: '' },
    ],
  },
  'system.memory': {
    title: 'Memory', kind: 'metrics', refreshHintSec: 5, group: 'system',
    metrics: [
      { id: 'system.memory.pct',      label: 'RAM',       kind: 'gauge', unit: '%', min: 0, max: 100, thresholds: T_MEM },
      { id: 'system.memory.used',     label: 'RAM used',  kind: 'bytes', unit: 'B' },
      { id: 'system.memory.total',    label: 'RAM total', kind: 'bytes', unit: 'B', spark: false },
      { id: 'system.memory.swap.pct', label: 'Swap',      kind: 'gauge', unit: '%', min: 0, max: 100, thresholds: T_MEM },
      { id: 'system.memory.swap.used',label: 'Swap used', kind: 'bytes', unit: 'B' },
    ],
  },
  'system.storage': {
    title: 'Storage', kind: 'list', refreshHintSec: 30, group: 'system',
    metrics: [], itemMetrics: [
      { id: 'pct',  label: 'Used', kind: 'gauge', unit: '%', min: 0, max: 100, thresholds: T_MEM },
      { id: 'used', label: 'Used', kind: 'bytes', unit: 'B' },
      { id: 'total',label: 'Total', kind: 'bytes', unit: 'B' },
    ],
  },
  'system.network': {
    title: 'Network & I/O', kind: 'list', refreshHintSec: 5, group: 'system',
    metrics: [
      { id: 'system.network.disk.read',  label: 'Disk read',  kind: 'rate', unit: 'B/s' },
      { id: 'system.network.disk.write', label: 'Disk write', kind: 'rate', unit: 'B/s' },
    ],
    itemMetrics: [
      { id: 'rx', label: 'Down', kind: 'rate', unit: 'B/s' },
      { id: 'tx', label: 'Up',   kind: 'rate', unit: 'B/s' },
    ],
  },
  'system.host': {
    title: 'Host', kind: 'metrics', refreshHintSec: 30, group: 'system',
    metrics: [
      { id: 'system.host.uptime', label: 'Uptime',    kind: 'duration', unit: 's' },
      { id: 'system.host.procs',  label: 'Processes', kind: 'counter',  unit: 'count' },
      { id: 'system.host.time',   label: 'Server time', kind: 'timestamp', unit: '' },
    ],
  },
  'docker.containers': {
    title: 'Containers', kind: 'list', refreshHintSec: 10, group: 'stack',
    metrics: [
      { id: 'docker.containers.running', label: 'Running', kind: 'counter', unit: 'count' },
    ],
    itemCommands: ['docker.container.start', 'docker.container.stop', 'docker.container.restart'],
    commands: ['compose.start', 'compose.stop', 'compose.restart'],
  },
  'services.inference': {
    title: 'Inference services', kind: 'list', refreshHintSec: 10, group: 'stack',
    metrics: [],
    itemCommands: ['services.start', 'services.stop'],
  },
  'models.ollama': {
    title: 'Ollama models', kind: 'list', refreshHintSec: 30, group: 'models',
    metrics: [
      { id: 'models.ollama.loaded', label: 'In memory', kind: 'counter', unit: 'count' },
    ],
    itemMetrics: [
      { id: 'size', label: 'Size', kind: 'bytes', unit: 'B' },
      { id: 'vram', label: 'VRAM', kind: 'bytes', unit: 'B' },
    ],
  },
  'models.llamacpp': {
    title: 'llama.cpp servers', kind: 'list', refreshHintSec: 30, group: 'models',
    metrics: [],
    itemCommands: ['llamacpp.start', 'llamacpp.stop', 'llamacpp.restart'],
  },
  'agent.prompts': {
    title: 'Agent', kind: 'metrics', refreshHintSec: 30, group: 'agent',
    metrics: [
      { id: 'agent.prompts.open', label: 'Open prompts', kind: 'counter', unit: 'count', spark: false },
    ],
  },
};

function gpuDef(i) {
  return {
    title: `GPU ${i}`, kind: 'metrics', refreshHintSec: 5, group: 'gpu',
    metrics: [
      { id: `gpu.${i}.name`,       label: 'Model',    kind: 'text',  unit: '' },
      { id: `gpu.${i}.temp`,       label: 'Temp',     kind: 'gauge', unit: '°C', min: 0, max: 110, thresholds: T_TEMP },
      { id: `gpu.${i}.util`,       label: 'Util',     kind: 'gauge', unit: '%',  min: 0, max: 100, thresholds: T_PCT },
      { id: `gpu.${i}.vram.pct`,   label: 'VRAM',     kind: 'gauge', unit: '%',  min: 0, max: 100, thresholds: T_MEM },
      { id: `gpu.${i}.vram.used`,  label: 'VRAM used', kind: 'bytes', unit: 'B' },
      { id: `gpu.${i}.vram.total`, label: 'VRAM total', kind: 'bytes', unit: 'B', spark: false },
      { id: `gpu.${i}.power`,      label: 'Power',    kind: 'gauge', unit: 'W' },
      { id: `gpu.${i}.fan`,        label: 'Fan',      kind: 'gauge', unit: '%', min: 0, max: 100 },
      { id: `gpu.${i}.clock.sm`,   label: 'Clock',    kind: 'gauge', unit: 'MHz' },
      { id: `gpu.${i}.pstate`,     label: 'P-state',  kind: 'enum',  unit: '', values: ['P0','P1','P2','P3','P4','P5','P6','P7','P8','P12'] },
    ],
  };
}

/** All surface definitions given the latest status (adds gpu.N). */
function definitions(status) {
  const out = {};
  for (const [id, d] of Object.entries(DEFS)) out[id] = { id, ...d };
  (status?.gpu || []).forEach((_, i) => { out[`gpu.${i}`] = { id: `gpu.${i}`, ...gpuDef(i) }; });
  return out;
}

/** Definition summary for capabilities (no values). */
function describe(def) {
  return {
    id: def.id, title: def.title, kind: def.kind, group: def.group, refreshHintSec: def.refreshHintSec,
    metrics: def.metrics.map(({ id, label, kind, unit, min, max, thresholds, values }) => ({ id, label, kind, unit, min, max, thresholds, values })),
    itemMetrics: def.itemMetrics || [],
    commands: def.commands || [],
    itemCommands: def.itemCommands || [],
  };
}

// ─── Snapshot builders ───────────────────────────────────────────────────────

function byId(def) { return Object.fromEntries(def.metrics.map(m => [m.id, m])); }

function buildSurface(id, def, sample, ctx, extra = {}) {
  const status = sample.status || {};
  const s = status.system || {};
  const M = byId(def);
  const out = { id, title: def.title, kind: def.kind, observedAt: ctx.observedAt, ttlSec: ctx.ttlSec, stale: !!ctx.stale, metrics: [], items: undefined };
  const push = (mid, v, ex) => { if (M[mid]) out.metrics.push(metric(ctx, M[mid], v, ex)); };

  switch (true) {
    case id === 'system.cpu':
      push('system.cpu.pct', s.cpuPct); push('system.cpu.temp', s.cpuTemp); push('system.cpu.freq', s.cpuFreqMHz);
      push('system.cpu.cores', s.cores || []); push('system.load.1', s.load1); push('system.load.5', s.load5); push('system.load.15', s.load15);
      break;
    case id === 'system.memory': {
      const pct = s.ramTotal ? Math.round(s.ramUsed / s.ramTotal * 100) : null;
      push('system.memory.pct', pct); push('system.memory.used', s.ramUsed != null ? s.ramUsed * 1e6 : null); push('system.memory.total', s.ramTotal != null ? s.ramTotal * 1e6 : null);
      push('system.memory.swap.pct', s.swapTotal ? Math.round(s.swapUsed / s.swapTotal * 100) : null); push('system.memory.swap.used', s.swapUsed != null ? s.swapUsed * 1e6 : null);
      break;
    }
    case id === 'system.storage':
      out.items = (s.disks || []).map(d => ({
        id: d.mount, label: d.mount, state: d.pct >= 95 ? 'error' : 'running',
        metrics: [
          metric(ctx, { id: 'pct', label: 'Used', kind: 'gauge', unit: '%', min: 0, max: 100, thresholds: T_MEM, spark: false }, d.pct),
          metric(ctx, { id: 'used', label: 'Used', kind: 'bytes', unit: 'B', spark: false }, d.usedKB * 1024),
          metric(ctx, { id: 'total', label: 'Total', kind: 'bytes', unit: 'B', spark: false }, d.totalKB * 1024),
        ],
      }));
      break;
    case id === 'system.network':
      push('system.network.disk.read', s.diskIO?.readBps ?? null); push('system.network.disk.write', s.diskIO?.writeBps ?? null);
      out.items = (s.net || []).map(n => ({
        id: n.iface, label: n.iface, state: 'running',
        metrics: [
          metric(ctx, { id: 'rx', label: 'Down', kind: 'rate', unit: 'B/s', spark: false }, n.rxBps),
          metric(ctx, { id: 'tx', label: 'Up', kind: 'rate', unit: 'B/s', spark: false }, n.txBps),
        ],
      }));
      break;
    case id === 'system.host':
      push('system.host.uptime', s.uptimeSec); push('system.host.procs', s.procCount); push('system.host.time', status.time || ctx.observedAt);
      break;
    case id.startsWith('gpu.'): {
      const i = parseInt(id.split('.')[1], 10);
      const g = (status.gpu || [])[i];
      if (!g) break;
      const used = parseFloat(g.memUsed), total = parseFloat(g.memTotal);
      push(`gpu.${i}.name`, g.name); push(`gpu.${i}.temp`, parseFloat(g.temp)); push(`gpu.${i}.util`, parseFloat(g.util));
      push(`gpu.${i}.vram.pct`, total > 0 ? Math.round(used / total * 100) : null);
      push(`gpu.${i}.vram.used`, used * 1024 * 1024); push(`gpu.${i}.vram.total`, total * 1024 * 1024);
      push(`gpu.${i}.power`, g.powerDraw, { max: g.powerLimit }); push(`gpu.${i}.fan`, g.fan); push(`gpu.${i}.clock.sm`, g.clockSm); push(`gpu.${i}.pstate`, g.pstate);
      break;
    }
    case id === 'docker.containers': {
      const cs = status.containers || [];
      push('docker.containers.running', cs.filter(c => itemState(c.State || c.Status) === 'running').length);
      out.items = cs.map(c => {
        const name = String(c.Names || c.Name || c.ID || '').replace(/^\//, '').split(',')[0];
        return { id: c.ID || name, label: name, state: itemState(c.State || c.Status), detail: c.Status || null,
                 commands: (def.itemCommands || []).map(cid => ({ id: cid, params: { id: c.ID || name } })) };
      });
      break;
    }
    case id === 'services.inference': {
      const cs = status.containers || [];
      out.items = INFERENCE_SERVICES.map(svc => {
        const c = cs.find(x => String(x.Names || '').split(',').includes(`doca-${svc.id}`));
        const state = c ? itemState(c.State || c.Status) : 'stopped';
        return { id: svc.id, label: svc.label, state, detail: svc.description,
                 commands: [{ id: state === 'running' ? 'services.stop' : 'services.start', params: { id: svc.id } }] };
      });
      break;
    }
    case id === 'models.ollama': {
      const loaded = new Map((status.loadedModels || []).map(m => [m.name, m]));
      push('models.ollama.loaded', loaded.size);
      out.items = (status.models || []).map(m => {
        const l = loaded.get(m.name);
        return { id: m.name, label: m.name.replace(/:latest$/, ''), state: l ? 'running' : 'stopped',
                 metrics: [
                   metric(ctx, { id: 'size', label: 'Size', kind: 'bytes', unit: 'B', spark: false }, m.size),
                   ...(l ? [metric(ctx, { id: 'vram', label: 'VRAM', kind: 'bytes', unit: 'B', spark: false }, l.sizeVram)] : []),
                 ] };
      });
      break;
    }
    case id === 'models.llamacpp': {
      const running = new Set((status.llamacppRunning || []).map(r => r.id));
      const instances = extra.llamacppInstances || (status.llamacppRunning || []);
      out.items = instances.map(inst => ({
        id: inst.id, label: inst.name || inst.id, state: running.has(inst.id) ? 'running' : 'stopped', detail: inst.port ? `:${inst.port}` : null,
        commands: [{ id: running.has(inst.id) ? 'llamacpp.stop' : 'llamacpp.start', params: { id: inst.id } }],
      }));
      break;
    }
    case id === 'agent.prompts':
      push('agent.prompts.open', extra.openPrompts ?? 0);
      break;
  }

  if (out.items) {
    if (out.items.length > 40) { out.truncated = out.items.length; out.items = out.items.slice(0, 40); }
  } else {
    delete out.items;
  }
  return out;
}

/**
 * Build snapshots for a set of surface ids the caller has already filtered
 * by scope. `opts.spark` enables sparklines; `opts.extra` carries per-device
 * context (open prompt count, llama.cpp instance list).
 */
async function snapshot(ids, opts = {}) {
  const sample = await sampler.latest(opts.maxAgeSec ?? 10);
  const defs = definitions(sample.status);
  const ctx = {
    observedAt: sample.observedAt,
    ttlSec: Math.max(15, sampler.intervalSec() * 3),
    stale: sample.stale,
    spark: !!opts.spark,
    sparkPoints: Math.min(L.SPARK_MAX_POINTS, opts.sparkPoints || L.SPARK_MAX_POINTS),
  };
  const out = [];
  for (const id of ids) {
    const def = defs[id];
    if (!def) continue;
    out.push(buildSurface(id, def, sample, ctx, opts.extra || {}));
  }
  return { surfaces: out, observedAt: sample.observedAt, stale: sample.stale };
}

/** Ids of all surfaces that currently exist. */
async function availableIds() {
  const sample = await sampler.latest(30);
  return Object.keys(definitions(sample.status));
}

module.exports = { UNITS, KINDS, STATES, DEFS, definitions, describe, snapshot, availableIds, fmtBytes, fmtDuration, metric };
