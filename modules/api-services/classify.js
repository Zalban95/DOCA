'use strict';

/**
 * One box for adding anything outside — "Service name, address or docs link" — used from Field → API keys → External
 * providers and from Field → Connectors → API services alike (asked 2026-10-10: two forms for "an external API" meant a
 * person setting up hi3d.ai filled the chat-model one, and never found the draft the agent had prepared for them).
 * The hub decides which form it is and says why in one line; the panel offers the other if that is wrong:
 *
 *   - a draft the agent prepared, by name or address           → the API service form, the draft open
 *   - a ready-made service (api-services/templates)             → the API service form, filled
 *   - a chat-model provider DOCA knows (harness/providers PRESETS) → the provider form, its address filled
 *   - an address that lists models at /models or /v1/models      → the provider form, tested (the models it lists)
 *   - any other address or docs link                            → the API service form, from its OpenAPI document when
 *                                                                  one is published (discover.js), else to fill or
 *                                                                  to let the agent prepare
 *   - a name nothing matches                                     → unknown: give its address, or ask the agent
 *
 * Nothing is saved. Every fetch is discover.js's or keys.probe's: a GET from the hub on the person's click.
 */
const { PRESETS } = require('../harness/providers');

const hostOf = s => { try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase(); } catch { return ''; } };
const hostPort = s => { try { const u = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`); return `${u.hostname}:${u.port || (u.protocol === 'https:' ? 443 : 80)}`; } catch { return ''; } };
const looksAddress = s => /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s) || /^\d+\.\d+\.\d+\.\d+(:\d+)?/.test(s);
/** The registrable part of a host's name, for matching docs.x.ai with api.x.ai: "hitem3d" for api.hitem3d.ai. */
const stem = h => { const p = h.split('.').filter(Boolean); return p.length >= 2 ? p[p.length - 2] : p[0] || ''; };

/** A short provider name from an address: groq for api.groq.com, local-8080 for 127.0.0.1:8080. */
function nameFor(url) {
  let u;
  try { u = new URL(url); } catch { return 'provider'; }
  if (require('net').isIP(u.hostname) || u.hostname === 'localhost') return `local-${u.port || (u.protocol === 'https:' ? 443 : 80)}`;
  const parts = u.hostname.toLowerCase().split('.').filter(p => !['api', 'www', 'inference', 'openai'].includes(p));
  return (parts.length > 1 ? parts[parts.length - 2] : parts[0] || 'provider').replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'provider';
}

/** The drafts the agent prepared, each with a ready-made service it matches (by address) — for the box's suggestions. */
function drafts() {
  const templates = require('./templates');
  return require('../service-drafts').all().map(d => {
    const t = templates.list().find(x => { try { return new URL(templates.load(x.id).definition.server).origin === d.origin; } catch { return false; } });
    return { id: d.id, name: d.name, origin: d.origin, note: d.note, docs: d.docs, at: d.at, ...(t ? { template: t.id } : {}) };
  });
}

function presetFor(raw) {
  const q = raw.toLowerCase(), h = hostOf(raw);
  return Object.entries(PRESETS).find(([id, p]) => {
    if (looksAddress(raw)) {   // the same host and port, or a hosted provider's own domain (console.mistral.ai)
      const ph = hostOf(p.baseUrl), local = x => require('net').isIP(x) || x === 'localhost';
      return h && (local(h) || local(ph) ? hostPort(p.baseUrl) === hostPort(raw) : stem(ph) === stem(h));
    }
    return q === id || p.label.toLowerCase() === q || p.label.toLowerCase().replace(/\s*\(.*\)$/, '') === q;
  });
}

async function classify(input, { probe = require('../keys').probe, find = require('./discover').find } = {}) {
  const raw = String(input || '').trim().slice(0, 500);
  const ds = drafts();
  const templates = require('./templates').list();
  const presets = Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, baseUrl: p.baseUrl }));
  if (!raw) return { kind: null, drafts: ds, templates, presets };
  const q = raw.toLowerCase(), h = hostOf(raw), address = looksAddress(raw);

  const draft = ds.find(d => d.name === q || (address && h && (hostOf(d.origin) === h || stem(hostOf(d.origin)) === stem(h))));
  if (draft) return { kind: 'service', why: `The agent prepared ${draft.name} for you (${draft.origin}) — check it and add its key.`, draft, drafts: ds };

  const preset = presetFor(raw);
  const providerOf = ([id, p]) => ({ kind: 'provider', why: `${p.label} is a chat-model provider DOCA knows: its address is filled in, paste the key.`, provider: { name: id, baseUrl: p.baseUrl, preset: id } });
  if (preset && !address) return providerOf(preset);

  // A name matches a template by its words; an address only by its host (a path naming one is somebody else's server).
  const tpl = require('./discover').templatesFor(address ? h : raw).filter(t => !address || h.includes(t.id) || (() => {
    try { return stem(new URL(require('./templates').load(t.id).definition.server).hostname) === stem(h); } catch { return false; }
  })());
  if (tpl.length === 1 || (tpl.length && !address)) {
    return { kind: 'service', why: `${tpl[0].title} is an API service, not a chat model — a ready-made one${tpl[0].note ? `: ${tpl[0].note}` : ''}.`, template: tpl[0].id, templates: tpl, drafts: ds };
  }

  if (preset) return providerOf(preset);

  if (!address) return { kind: 'service', unknown: true, why: `No ready-made service or known chat-model provider is called "${raw}". Give its address or docs link — or let the agent read its docs and prepare it.`, drafts: ds, templates };

  // An address: does it answer like a chat-model server?
  const start = /^https?:\/\//i.test(raw) ? raw : (/^(\d+\.|localhost)/.test(raw) ? `http://${raw}` : `https://${raw}`);
  const base = start.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const tries = [base, ...(/\/v\d+$/i.test(base) ? [] : [`${base}/v1`])];
  for (const b of tries) {
    const r = await probe(b, '', { timeoutMs: 6000 });
    if (!r.error) return { kind: 'provider', why: `It answers like a chat-model server: ${r.models.length} model${r.models.length === 1 ? '' : 's'} at ${b}/models.`, provider: { name: nameFor(b), baseUrl: b, models: r.models.slice(0, 50) } };
  }

  const found = await find(raw);
  if (found.definition) {
    return { kind: 'service', why: `It does not list chat models, and it publishes an OpenAPI document at ${found.found}: ${found.definition.actions?.length || 0} actions — an API service.`, found, drafts: ds };
  }
  return { kind: 'service', why: `It does not answer like a chat-model server and no OpenAPI document was found there (tried ${found.tried?.length || 0} places) — an API service to fill in, or for the agent to prepare from its docs.`,
    found: { ...found, definition: null }, docs: found.docs || start, drafts: ds };
}

module.exports = { classify, drafts, nameFor, looksAddress };
