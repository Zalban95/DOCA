'use strict';

/**
 * What changed out there, with no model (docs/experiments/model-scout.md): the cheap half of the model scout, run
 * daily by the ticker and on demand by the `scout` tool.
 *
 *   trending   Hugging Face's trending models for each task DOCA uses (roles.js), with likes and downloads; each run's
 *              numbers are kept, so a model that gained `scout.growthLikes` likes since the last look is "growing fast".
 *   releases   new releases of the projects DOCA runs or builds on (`scout.watch`: GitHub owner/repo), from their Atom feeds.
 *   news       new items in the feeds the owner follows (`scout.feeds`: RSS or Atom).
 *
 * Everything is titles, names and numbers — no page text reaches an agent from here; reading a page is the scout
 * specialist's job, through the airlock. What was seen is kept in DATA_DIR/scout/seen.json, so "new" means new since
 * the last look.
 */
const fs = require('fs');
const path = require('path');

const dir = () => path.join(require('../store').DATA_DIR, 'scout');
const seenFile = () => path.join(dir(), 'seen.json');
const loadSeen = () => { try { return JSON.parse(fs.readFileSync(seenFile(), 'utf8')); } catch { return { models: {}, items: {}, at: null }; } };
const saveSeen = s => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(seenFile(), JSON.stringify(s)); };

const HF = () => (process.env.DOCA_HF_API || 'https://huggingface.co/api').replace(/\/+$/, '');
const get = async (url, as = 'json') => {
  const r = await fetch(url, { headers: { 'User-Agent': 'DOCA-scout', Accept: as === 'json' ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return as === 'json' ? r.json() : r.text();
};

/** Trending models for one Hugging Face task. */
async function trending(task, limit = 15) {
  const rows = await get(`${HF()}/models?${task === 'any' ? '' : `pipeline_tag=${encodeURIComponent(task)}&`}sort=trendingScore&direction=-1&limit=${limit}`);
  return (Array.isArray(rows) ? rows : []).map(m => ({ id: m.id || m.modelId, likes: m.likes || 0, downloads: m.downloads || 0, task, created: m.createdAt || null, lastModified: m.lastModified || null }));
}

/** Entries of an RSS or Atom feed: title, link, date. A regex reader — a feed's title and link are all that is kept. */
function feedItems(xml) {
  const text = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map(m => m[0]);
  return blocks.map(b => {
    const title = text((b.match(/<title\b[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
    const link = (b.match(/<link\b[^>]*href="([^"]+)"/) || [])[1] || text((b.match(/<link\b[^>]*>([\s\S]*?)<\/link>/) || [])[1]);
    const date = text((b.match(/<(updated|published|pubDate)\b[^>]*>([\s\S]*?)<\/\1>/) || [])[2]);
    return { title: title.slice(0, 200), link, date };
  }).filter(i => i.title && i.link);
}

/**
 * One look: every role's trending models (growth against the last look), new releases of watched projects, new
 * news items. `notable` is what is worth waking the scout for.
 */
async function look({ roles = require('./roles').roles(), settings = require('./index').settings(), keep = true } = {}) {
  const seen = loadSeen(), now = new Date().toISOString(), failures = [];
  const tasks = [...new Set(roles.flatMap(r => r.tasks))];
  const models = [];
  for (const task of tasks) {
    try { models.push(...await trending(task)); } catch (e) { failures.push(`Hugging Face (${task}): ${e.message}`); }
  }
  for (const m of models) {
    const before = seen.models[m.id];
    m.gained = before ? m.likes - before.likes : null;
    m.isNew = !before;
    m.fast = m.gained !== null && m.gained >= settings.growthLikes;
    m.roles = roles.filter(r => r.tasks.includes(m.task)).map(r => r.id);
    m.inUse = roles.some(r => r.current && r.current.toLowerCase().includes(m.id.toLowerCase().split('/').pop()));
  }
  const fresh = [];
  const feeds = [...settings.watch.map(repo => ({ url: `https://github.com/${repo}/releases.atom`, kind: 'release', source: repo })),
    ...settings.feeds.map(url => ({ url, kind: 'news', source: (() => { try { return new URL(url).host; } catch { return url; } })() }))];
  for (const f of feeds) {
    try {
      for (const i of feedItems(await get(f.url, 'text')).slice(0, 10)) {
        const key = `${f.kind}:${i.link}`;
        if (!seen.items[key]) fresh.push({ ...i, kind: f.kind, source: f.source });
        seen.items[key] = seen.items[key] || now;
      }
    } catch (e) { failures.push(`${f.source}: ${e.message}`); }
  }
  // The first look has nothing to compare with: everything is "new", and none of it is news.
  const first = !seen.at;
  if (keep) {
    for (const m of models) seen.models[m.id] = { likes: m.likes, downloads: m.downloads, at: now };
    const keys = Object.entries(seen.items).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 3000);
    seen.items = Object.fromEntries(keys);
    seen.at = now;
    saveSeen(seen);
  }
  const notable = first ? [] : [...models.filter(m => m.fast && !m.inUse).map(m => ({ kind: 'growing', what: m.id, detail: `+${m.gained} likes since ${seen.at ? 'the last look' : 'never'} (${m.task})` })),
    ...fresh.filter(i => i.kind === 'release').map(i => ({ kind: 'release', what: i.source, detail: i.title }))];
  return { at: now, first, models, fresh: first ? [] : fresh, notable, failures, lastLook: seen.at };
}

/** For the agent: a few lines a role, names and numbers. */
function brief(r, roles = require('./roles').roles()) {
  const lines = [`Signals ${r.at}${r.first ? ' (the first look: nothing to compare with yet)' : ''}.`];
  for (const role of roles) {
    const ms = r.models.filter(m => m.roles.includes(role.id)).slice(0, 6);
    lines.push(`\n## ${role.label} — now: ${role.current || 'nothing set'}`);
    for (const m of ms) lines.push(`- ${m.id} · ${m.likes} likes${m.gained != null ? ` (+${m.gained})` : ''} · ${m.downloads} downloads${m.fast ? ' · GROWING FAST' : ''}${m.inUse ? ' · in use here' : ''}`);
  }
  if (r.fresh.length) lines.push('\n## New releases and news', ...r.fresh.slice(0, 20).map(i => `- [${i.kind}] ${i.source}: ${i.title} — ${i.link}`));
  if (r.failures.length) lines.push('\n## Could not look', ...r.failures.map(f => `- ${f}`));
  return lines.join('\n');
}

module.exports = { look, brief, trending, feedItems, loadSeen };
