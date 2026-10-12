'use strict';

/**
 * DOCA's own llama.cpp servers come back after a restart (asked 2026-10-12, found when a version switch left the quick
 * vision model and the locator off: their llama-server processes are DOCA's children and end with it). The same rule
 * as MCP servers (mcp/recall.js): a start through the panel records the server as running, a stop by a person forgets
 * it, shutting down does neither — so what was running when DOCA stopped runs again when it starts, and a server
 * marked `autostart` ("start with DOCA") always does. Each start is an activity line (nothing runs unseen).
 */
const DOC = 'llamacpp-running';

function record(id, on) {
  try {
    const store = require('./store'), doc = store.readJson(DOC, { ids: [] });
    const ids = new Set(doc.ids || []);
    if (on) ids.add(id); else ids.delete(id);
    store.writeJson(DOC, { ids: [...ids] });
  } catch { /* a convenience, never a failure */ }
}

const running = () => { try { return new Set(require('./store').readJson(DOC, { ids: [] }).ids || []); } catch { return new Set(); } };

/** Starts one instance through the panel's own handler, answering {ok, text}. */
function startOne(id) {
  const llama = require('./models-llamacpp');
  return new Promise(resolve => {
    let text = '', code = 200, done = false;
    const finish = r => { if (!done) { done = true; resolve(r); } };
    const res = {
      setHeader() {}, flushHeaders() {}, on() {},
      status(c) { code = c; return this; },
      json(b) { finish({ ok: code < 400 && b?.ok !== false, text: b?.error || '' }); },
      write(chunk) {
        const m = String(chunk).match(/^data: (.*)$/m);
        try { const d = JSON.parse(m?.[1] || '{}'); if (d.status) text = d.status; if (d.done) finish({ ok: !!d.ok, text: String(d.status || '').trim() }); } catch { /* a partial frame */ }
      },
      end() { finish({ ok: true, text: text.trim() }); },
    };
    llama.handleStart({ body: { id } }, res);
  });
}

/** At start: what was running when DOCA stopped, and what is marked to start with it. */
async function resume() {
  const llama = require('./models-llamacpp');
  const was = running();
  for (const inst of llama.loadInstances()) {
    const why = inst.autostart ? 'marked "start with DOCA"' : was.has(inst.id) ? 'it was running when DOCA last stopped' : null;
    if (!why) continue;
    const r = await startOne(inst.id);
    require('./activity').note({ from: 'llama.cpp', what: `${r.ok ? 'started' : 'could not start'} ${inst.name || inst.id}${r.ok ? '' : `: ${r.text.split('\n').pop()}`}`, why,
      machine: { kind: 'llamacpp', id: inst.id, name: inst.name || inst.id }, act: 'start', ok: r.ok });
  }
}

module.exports = { record, running, resume, startOne };
