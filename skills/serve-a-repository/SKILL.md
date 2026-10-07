---
name: serve-a-repository
description: Run someone's repository so the person can see what it does — clone it, start it with its own command, and hand over the page it serves as a window, a tab of its own or Machines → Live, from any screen. Use when the person says "show me what that repo does", "run it so I can see", "try this project", or gives a GitHub/GitLab link and wants to see it working.
---

# Serving a repository as a page

The person gives a repository (a link, or a name you can find) and wants to **see it working**. You clone it, start it
the way its own files say, and the address it prints becomes a page they open on any screen. Then you keep the steps,
so next time it is one recipe.

## 1. Decide where it runs — before anything is cloned

A repository's install and start commands run its authors' code with whatever rights they get.

- **Not the person's own → an agents' computer.** Anything from someone else (a stranger's GitHub, a link from a
  chat, a package you found) runs in a computer: `computer` create, purpose "run <repo> to show it". Its own Linux,
  its own files; the hub is never touched.
- **Their own → here, in a project.** Theirs means: a folder already on this machine, a project they opened, or a
  remote in their own account or organisation (ask if you cannot tell — "is this yours?" costs one line).
- **They say otherwise, it is otherwise.** "Run it here" for a stranger's repository is the person's call: say once
  that its code will run on this machine with this machine's rights, then do it here. Never decide that on your own.

On the hub every `shell` call still goes through the person's approvals; do not look for a way around them.

## 2. Clone it

- **In a computer:** `mcp__computer-<id>__shell` with `git clone --depth 1 <url> ~/work/<name>`.
- **Here:** `shell` with `git clone --depth 1 <url> <workspace>/<name>` (the environment block names the workspace),
  then `project` open with that folder as root and `project` bind, so the commands and checkpoints are the project's.
  Then `repo_rules` on it: the repository may say how it wants to be run.

## 3. Find its own command — read, do not guess

Read in this order and stop at the first that says how to run it (`read_file` / `list_dir` here, the computer's
`read_file` and `list_dir` there):

1. **README** — a "Getting started", "Run locally", "Development" or "Quick start" section.
2. **package.json** `scripts`: `dev`, then `start`, then `serve`, `preview`. The package manager is the lock file's:
   `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun, else npm.
3. **docker-compose.yml / compose.yaml** — `docker compose up` (here only; a computer has no Docker inside it).
4. **Makefile** targets: `run`, `dev`, `serve`, `start`.
5. **pyproject.toml / requirements.txt** — the framework's own runner (`uvicorn app:app`, `flask run`,
   `python manage.py runserver`, `streamlit run app.py`, `gradio app.py`).
6. **Cargo.toml / go.mod** — `cargo run`, `go run .`.
7. A plain folder of HTML — `python3 -m http.server`.

Install its dependencies the same way (`npm ci` or `npm install`, `pip install -r requirements.txt` in a venv, …).
If it needs keys or a database it does not bring, say what it asks for and stop there — never invent a value.

## 4. Start it in the background

A server never exits, so it never runs as a plain call.

- **Here:** `project` run with the command's name when the project lists it, otherwise `shell` with
  `background: true`. Follow it with `shell_job` output until it prints its address ("Local: http://localhost:5173",
  "Listening on :3000", "Running on http://127.0.0.1:8000").
- **In a computer:** the person reaches only its **page port, 8080**, and only when the server listens on
  **0.0.0.0** (a server on 127.0.0.1 inside the container answers nobody outside it). Set both with the framework's
  own flags or `PORT=8080` / `HOST=0.0.0.0` — Vite: `-- --host 0.0.0.0 --port 8080`; Next: `-- -H 0.0.0.0 -p 8080`;
  uvicorn: `--host 0.0.0.0 --port 8080`; Flask: `--host 0.0.0.0 --port 8080`; Django: `0.0.0.0:8080`;
  `python3 -m http.server 8080 --bind 0.0.0.0`. Start it detached so the shell call returns, with its output in a
  file and the parentheses kept (without them the whole `cd … &&` line waits in the background and the call never
  returns): `cd ~/work/<name> && (nohup <command> > ~/work/serve.log 2>&1 < /dev/null &)`, then read
  `~/work/serve.log` until it says it is listening.

If it fails, read the error, fix what is the environment's (a missing tool, a port taken), and say plainly what is the
repository's own (it does not build, it needs a service you do not have).

## 5. Hand it over

- `canvas` preview — with `port` (the one it printed) here, with `computer` for a computer's page port. The person
  gets a button in the chat that opens it beside the chat, from any device, even when it listens on localhost only;
  ↗ there opens it in a tab of its own.
- **Machines → Live** shows it as a picture among the agents' work — `/?view=live` puts that page alone on a screen of
  its own. Mention it when they want to keep watching it.
- In a computer you can also look yourself: `mcp__computer-<id>__browser_open` with `http://localhost:8080`, then a
  screenshot, to check it really draws before you say it works.

Say in two lines what it is and how to use it, then what you ran ("`npm run dev` in a computer").

## 6. Keep the steps

When it worked: `recipe` save_last — the clone, the install and the start, with the repository's address and folder
as parameters — so "run it again" (or another branch of it) needs no thinking. Say the recipe's name.

When they are done: stop it (`shell_job` stop, or `computer` stop — its files stay; `computer` remove when they do not
want it back).
