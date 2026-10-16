'use strict';

/**
 * Saving a project's values (the mask's Save, the agent's `project_params set`, a device's POST): checked against
 * their declarations, refused when the file changed since it was read (`ifMatch`, so nobody overwrites another's edit
 * silently), written with only what differs from the defaults, committed with a line that says what changed
 * (`params: tab_w 200 → 210`; a checkpoint when the project is not a git repository) — and then built at once, as the
 * person who saved (owner, 2026-10-16: the person's own click is the decision, CONSTITUTION S1). A value declared
 * `lock: true` is the person's alone: an agent's change to it is refused.
 */
const file = require('./file');

const bad = (m, status = 400, more = {}) => Object.assign(new Error(m), { status, ...more });

/** The commit line for a set of changes. */
const message = changes => `params: ${changes.map(c => `${c.name} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join(', ')}`.slice(0, 300);

async function record(p, changes) {
  const git = require('../projects/git');
  try {
    if (await git.top(p.root)) {
      await git.git(p.root, ['add', '--', file.NAME]);
      await git.git(p.root, ['commit', '-m', message(changes), '--', file.NAME]);
      return { commit: (await git.log(p.root, { limit: 1 }))[0]?.short || null };
    }
  } catch (e) { return { recorded: `not committed: ${String(e.message).split('\n')[0]}` }; }
  const cp = await require('../projects/checkpoints').take(p, { label: message(changes), by: 'person' }).catch(() => null);
  return cp ? { checkpoint: cp.id } : {};
}

/**
 * @returns {{ changes, hash, commit?, checkpoint?, build? }} — `build` the started build's state, unless `build: false`
 *   or nothing changed (an unchanged Save builds only when the last build does not hold).
 */
async function save(p, { values, ifMatch = null, person = null, client = null, byAgent = false, build = true, acceptBuild = false, say = false } = {}) {
  const f = file.read(p.root);
  if (!f.exists) throw bad(`There is no ${file.NAME} in ${p.name}.`, 404);
  if (f.errors.length) throw bad(`${file.NAME} has problems: ${f.errors.join(' ')}`);
  if (ifMatch && ifMatch !== f.hash) {
    const now = file.view(f.doc).params.map(x => ({ name: x.name, value: x.value }));
    throw bad('The parameters changed since you opened them: look at the values now and save again.', 409, { code: 'stale', hash: f.hash, values: now });
  }
  if (byAgent) {
    const locked = Object.keys(values || {}).filter(n => f.doc.params?.[n]?.lock);
    if (locked.length) throw bad(`${locked.join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked: the person's to change, in the mask.`, 403);
  }
  const { doc, changes } = file.withValues(f.doc, values);
  if (build && !acceptBuild && !say) {   // a build changed since this person ran it is shown before anything is written
    const st = require('./stamp'), ch = st.changedFor(person, p.id, p.root, st.fingerprint(p.root, f.doc));
    if (ch.changed) throw bad(`${st.changedLine(ch)} Look at it, then save again to accept it.`, 409, { code: 'build_changed', change: ch });
  }
  let out = { changes, hash: f.hash };
  if (changes.length) {
    const w = file.write(p.root, doc);
    out = { ...out, hash: w.hash, ...(await record(p, changes)) };
  }
  if (build && doc.build?.length && (changes.length || !require('./stamp').builtNow(p.root).ok)) {
    const st = require('./build').start(p, { person, client, acceptBuild, say });
    out.build = { ...st, promise: undefined };
    Object.defineProperty(out, 'done', { value: st.promise, enumerable: false });
  }
  return out;
}

module.exports = { save, message };
