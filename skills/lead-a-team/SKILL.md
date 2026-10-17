---
name: lead-a-team
description: Lead a team of agents to a result that is rich and right, quickly, even on a cheaper model — the contract written first, one owner per file, many small tasks at once, contracts that fail until the work is real, the parts merged by the hub, a review, then the fixes on the same board. Use whenever you make a team, split a big job across specialists, or a team's result came out thin.
triggers: [team, team of agents, split the work, several agents, in parallel, specialists, a squadra, team di agenti, squadra, in parallelo, dividi il lavoro]
---

# Lead a team

A team does well what its leader made clear. A cheaper model follows a sharp contract well and fills a vague one
with the least it can get away with — so the leader's first twenty minutes decide the result. Five things make the
difference.

1. **The contract before the team.** In the project, before `team` create: the skeleton the parts plug into (a
   starter when a skill has one — `make-a-browser-game` for games), a plan that lists every piece of content by name
   and number, sized to what the person asked ("rich" is many things, made well), and how each part is checked. Write
   it into the project (`docs/`) and commit it. The team reads files, not this conversation.
2. **One owner per file, many tasks at once.** Split by files, not by phases: each task owns a folder or a few files
   and is told which; nobody edits another's. Shared lists (an index, a registry) are written by a script or owned
   by one task. Then ten tasks run at once in their own worktrees and nothing conflicts. Ten small tasks finish
   sooner and better than three large ones.
3. **Contracts that fail until the work is real.** Every code task gets `test` (the project's test command) and a
   "done when" a person would see. A check the scaffold already meets proves nothing, and `team` refuses it. Make the
   test list what is missing (a plan file the tests read), so "done" means the planned content exists, not that a
   file does.
4. **The parts come together by themselves.** A task after several starts from all their branches merged (the hub
   merges them and names any conflict). End the first wave with an **integrate** task after every part: it fixes the
   seams only and runs the whole test. Then a **review** task (a tester) after it, which plays or uses the result,
   reads the plan, and reports a numbered list of what is wrong or missing with the files that own each. It fixes
   nothing.
5. **The fixes go on the same board.** Read the review and `team` add one task per owner's files, after review, then
   a last task that runs the whole test. Merge the last task's branch into the project (`team` merge) and hand over.

While the team works, lead — do not do its work. Answer questions, read `team` status, add tasks. If you notice
yourself writing tooling around the task (a robot player, a harness for a harness), stop: that is a task for the
team, or not needed.

What you tell every member, in the team's context: where the contract is and to read it first; which files are
theirs; the test to run last; keep the code simple and the content as rich as the plan (`ponytail` is about code,
never fewer features); commit on your branch with a message that says why; say in your report what you could not do.
