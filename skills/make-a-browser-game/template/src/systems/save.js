// Progress and settings, kept in the browser. Read with load(), change with save({...}) — it merges.
const KEY = '__SLUG__-save';
const DEFAULTS = { unlocked: 1, best: {}, settings: { music: true, sfx: true, volume: 0.7 } };

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...s, settings: { ...DEFAULTS.settings, ...(s.settings || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}

export function save(change) {
  const next = { ...load(), ...change };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: progress lasts this visit */ }
  return next;
}

/** A level finished: unlock the next and keep the best score. */
export function finished(index, score) {
  const s = load();
  const best = { ...s.best, [index]: Math.max(score, s.best[index] || 0) };
  return save({ unlocked: Math.max(s.unlocked, index + 2), best });
}
