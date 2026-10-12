'use strict';

/**
 * A project's team branches (`team/…`: an outside harness's worker, or a specialist's worktree on a team), as git says
 * them — what each adds over the project's current branch, its diff, and merging it in. Read from git alone, never from
 * what an agent wrote. Merging is an ordinary `git merge --no-ff` in the project's folder, the person's (Projects → Team
 * branches) or the team's leader's (`team merge`): refused while the folder has uncommitted changes, and on a conflict
 * the merge is undone and the conflicting files are named — never forced.
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const git = (root, args, o) => require('../projects/git').git(root, args, o);
const quiet = p => p.then(x => String(x).trim(), () => '');
const NAME = /^team\/(?!.*\.\.)[\w./-]{1,120}$/;

/** Every team branch with what it adds over HEAD: commits ahead, the shortstat, the newest commit, and whose it is. */
async function list(root) {
  const out = await quiet(git(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso-strict)%09%(subject)', 'refs/heads/team/']));
  const current = await quiet(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']));
  const workers = require('./store').rows();
  const rows = [];
  for (const l of out.split('\n').filter(Boolean).slice(0, 40)) {
    const [branch, head, date, subject] = l.split('\t');
    const ahead = Number(await quiet(git(root, ['rev-list', '--count', `HEAD..${branch}`]))) || 0;
    const stat = ahead ? await quiet(git(root, ['diff', '--shortstat', `HEAD...${branch}`])) : '';
    const w = [...workers].reverse().find(x => x.branch === branch);
    rows.push({ branch, head, date, subject, ahead, merged: ahead === 0, stat,
      ...(w ? { by: { harness: w.harness, label: w.label, state: w.state, teamId: w.teamId, task: w.task, missionId: w.missionId } } : {}) });
  }
  return { current, branches: rows };
}

/** One branch's changes over the project's current branch: files with lines added and removed, and the diff. */
async function diff(root, branch) {
  if (!NAME.test(String(branch))) throw bad('A team branch is named team/….');
  const numstat = await git(root, ['diff', '--numstat', `HEAD...${branch}`]);
  const files = numstat.split('\n').filter(Boolean).map(l => { const [a, d, ...p] = l.split('\t'); return { path: p.join('\t'), added: a === '-' ? null : +a, removed: d === '-' ? null : +d }; });
  const text = await git(root, ['diff', `HEAD...${branch}`]);
  return { branch, files, diff: text.length > 400000 ? `${text.slice(0, 400000)}\n… (cut at 400 KB)` : text };
}

/** Merge a team branch into the project's current branch. Resolves {merged, into, head}; a conflict throws 409 naming files. */
async function merge(root, branch, { by = 'a person' } = {}) {
  if (!NAME.test(String(branch))) throw bad('A team branch is named team/….');
  if (!(await quiet(git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])))) throw bad(`No branch ${branch} in this project.`, 404);
  const dirty = await quiet(git(root, ['status', '--porcelain', '--untracked-files=no']));
  if (dirty) throw bad(`The project's folder has uncommitted changes (${dirty.split('\n').length} file(s)): commit or stash them, then merge.`, 409);
  const into = await quiet(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']));
  try {
    await git(root, ['merge', '--no-ff', '--no-edit', '-m', `Merge ${branch} (a team's work, merged by ${by})`, branch], { timeout: 120000 });
  } catch (e) {
    const conflicts = (await quiet(git(root, ['diff', '--name-only', '--diff-filter=U']))).split('\n').filter(Boolean);
    await git(root, ['merge', '--abort']).catch(() => {});
    if (conflicts.length) throw Object.assign(bad(`${branch} conflicts with ${into} in ${conflicts.join(', ')}: nothing was merged. Resolve it by hand, or ask for the work again on top of ${into}.`, 409), { conflicts });
    throw bad(`The merge did not go through: ${e.message}`, 409);
  }
  const head = await quiet(git(root, ['log', '-1', '--format=%h %s']));
  require('../activity').note({ from: 'harness-teams', what: `merged ${branch} into ${into}`, why: `merged by ${by}` });
  return { merged: branch, into, head };
}

module.exports = { list, diff, merge, NAME };
