'use strict';

/**
 * The line "Your tools" shows for a tool whose description's first sentence cannot serve: too long (it was cut at
 * 150 characters mid-word, 21 of them), or not saying when to use it ("Manage the three-level workspace.").
 * Audit 2026-10-06, aw 16–17 (TODO B4): a weaker model chooses by these lines, so each says what it does and when,
 * in one sentence of at most 150 characters. The schema still carries the whole description.
 */
const LEADS = {
  work_chats: 'Start, brief, read and stop level-2 work chats — use it to hand a job with several steps to a work chat and stay free.',
  work_plan: 'Read, draft or propose a durable plan — use it when a job needs the person\'s approval before work starts.',
  shell_job: 'Check, read or stop a command started with shell background: true — use it for builds and servers that outlive a step.',
  read_file: 'Read a text file on the host, whole or a slice — use it before editing a file or answering from one.',
  repo_rules: 'Read a git repository\'s rules, branch and uncommitted changes — call it before your first change in that repository.',
  effort: 'Set how hard you think in this conversation — use it when the person asks you to think harder or answer quickly.',
  form_fill: 'Fill a form on the person\'s screen as a draft they save — use it when they ask for help filling a named form.',
  panel_layout: 'Change the panel\'s layout, pages and style for the person who asks — use it for "hide", "move", "bigger text", "a page with X and Y".',
  settings_propose: 'Suggest a settings change the person accepts or declines — use it instead of editing settings any other way.',
  install_propose: 'Ask the person to install a model, service, harness, MCP server or system tool the panel knows — never install by hand.',
  mcp_draft: 'Prepare an MCP server that is not in the catalogue for a person to add — use it when a task needs a server nobody set up.',
  spend_propose: 'Ask the person to allow spending money on a service or purchase — use it whenever work would cost money.',
  service_draft: 'Prepare a web API that needs a key for a person to switch on — use it when a task needs a service with no key stored.',
  permission_grant: 'Give a mission you dispatched one more permission — use it when a specialist reports a refusal for a step it needs.',
  mcp_connect: 'Start or stop an MCP server a person already set up — use it when you need the tools of a server that is stopped.',
  tell_device: 'Send a notice or files (audio, video, documents, pictures) to the person\'s phone, watch or chat — Telegram, Matrix, Slack, mail.',
  doca_clients: 'List the paired devices, who is online and what each may do — use it before reaching the person on a device.',
  canvas: 'Open a page beside the chat (a tool, a table, a diagram, a report) — use it when a result reads better laid out than as text.',
  search_files: 'Search the text of files under a folder — use it instead of grep in the shell to find where something is.',
  git: 'Status, log, diff, show, branches, stage, commit and switch in a repository — use it for git work; it never pushes or resets.',
  project: 'A project\'s commands, info and worktrees — use it to run a project\'s build or test, or to work in a worktree of its own.',
  tool_note: 'Propose a note about a tool that this install taught you — use it when a tool has a quirk its description does not say.',
  skill: 'Read, list or write a skill (a procedure for a kind of task) — read one when the task matches a skill in your prompt.',
  computer: 'Make or manage a Linux desktop in a container — use it for risky tests, sites used as a person would, or recording a demo.',
  computer_login: 'Sign in on a computer\'s browser with a login the owner keeps, without seeing its password — use it at a sign-in page.',
  secret_use: 'Type or paste a password or key on the person\'s own device, never seeing it — use it when a device must enter a secret.',
  computer_look: 'Ask what is on a computer\'s screen and where — use it when browser_snapshot finds nothing to number.',
  computer_next: 'Get the likeliest next element of a computer\'s page for a goal, with probabilities — use it to pick fast on a busy page.',
  vnc_look: 'See a VNC screen (another machine the owner added) and what is where on it — use it before and after vnc_input.',
  vnc_input: 'Click, scroll, type or press keys on a VNC screen (another machine) — use it to act there; never for a password.',
  recipe: 'Run a saved sequence of tool calls again, or save one — run a recipe when one does exactly what is asked.',
  pack: 'Keep skills, recipes and specialists you made as one pack in the library — use it when the owner wants to share them.',
  system_status: 'CPU, RAM, GPU, disks, containers and every local model server with who it works for — use it to see what the machine is doing.',
  http_fetch: 'Read a URL (GET or HEAD) — the open web through a reader, your own addresses as they are; or keep a download.',
  api_call: 'Call a keyed service or one of the owner\'s own devices and servers — use it to send, upload or act on an API.',
  screen: 'List the screens and the page each shows, or put a page on one — use it for "what is on the tablet" or "show the Workstream on the wall".',
  chronicle: 'Read what happened — runs, missions, jobs, the hub\'s log, a piece of work\'s story and cost — use it for "what happened", "why did it fail".',
  hub_command: 'Run the hub\'s own commands — start or stop a service, a container, a llama.cpp server, take a snapshot — instead of shell.',
  today: 'The weather, today\'s calendar and what is waiting for the person — use it for "what\'s my day" or a morning brief.',
  schedule: 'Propose a message or recipe on a timetable, which the person switches on — use it when asked to do something regularly.',
  features: 'Look up what DOCA can do, where it is and how to switch it on — use it before saying something cannot be done.',
};

module.exports = { LEADS };
