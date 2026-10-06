---
name: reach-another-machine
description: Work on one of the person's other computers through its DOCA client (DocaDesk, doca-client) — run commands, read and write files, move git work between machines without losing any.
---

# Working on another of the person's machines

A computer with DocaDesk or `doca-client` is an MCP server DOCA can reach: the environment lists it under **MCP servers** as "hosted by <device> — a separate machine". Its `shell`, `files_*`, `screen_*`, `input_*` tools act **there**: its paths, its programs, its `localhost`.

1. **Connect.** A stopped one: `mcp_connect {server, action: "start"}` (a person set it up; you never add one). If it fails, the client is not running or the machine sleeps — ask the person at that machine. When done, `mcp_connect … "stop"` if it was stopped before.
2. **Know the shell.** DocaDesk is Windows PowerShell 5.1: `;` between commands, `$env:USERPROFILE`, `Get-ChildItem`, `D:\…` paths. git writes progress to stderr, which PowerShell prints as red errors — read the result, not the colour (`2>$null` quiets it).
3. **Look before touching.** For each repository: `git status --porcelain`, `git branch --show-current`, `git fetch origin`, `git for-each-ref --format="%(refname:short) %(upstream:short) %(upstream:track)" refs/heads`, `git stash list`.
4. **Moving work between machines — never lose any:**
   - Uncommitted work: `git switch -c <machine>/<what>-<date>` (the working files stay as they are), `git add -A`, commit saying where it came from, `git push -u origin <branch>`. The person's files on disk are unchanged; they are now on a branch.
   - A branch ahead of its remote: push it. One that has diverged: push it under a new name (`git push origin main:refs/heads/<machine>/main`), never force.
   - Then on this machine: fetch and merge those branches on a branch of your own; resolve conflicts keeping both sides' intent; build and test; merge and push.
   - Finally bring the other machine forward only where nothing would be lost: fast-forward (`git merge --ff-only`), and do not switch a checkout something may be running from (`git fetch origin main:main` updates a branch without checking it out).
5. **Secrets stay where they are** unless the task needs them; if one must move (a signing key), put it in the hub's protected keys (a panel route), never in a repository or a message.

Report per repository: what was there, what was pushed where, what was merged, what each machine is on now.
