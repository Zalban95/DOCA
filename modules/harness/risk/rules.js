'use strict';

/**
 * The risk tiers' table (experiment riskTiers, docs/experiments/risk-tiers.md; TODO H10.11). Data only — classify.js
 * reads it — so what counts as a read, a change with a way back, or a call that leaves the hive or cannot be undone is
 * one list a person can read and a test can hold:
 *
 *   read        changes nothing
 *   reversible  changes something with a way back (`way` names it), or stays inside the hive
 *   outward     leaves the hive — another person, another service, the public — or destroys what nothing can restore
 *
 * TOOLS: per tool, rows tried in order; `when` matches arguments (a value, a list of values, a RegExp or a predicate),
 * a row without `when` is the tool's default. `touches` marks a call that changes files where a project checkpoint
 * covers it. A tool with no row is reversible with no automatic way back.
 */
const NOT_GET = m => !['GET', 'HEAD'].includes(String(m || 'GET').toUpperCase());
const owned = url => require('../toolbox/http').owned(String(url || ''));

const WAY = {
  backup: 'the file\'s previous version is kept under .doca/harness/backups/',
  project: 'a project checkpoint (Projects → Checkpoints)',
  proposal: 'a proposal: nothing changes until a person accepts it',
  memory: 'memory keeps the last three values of an entry',
  computer: 'inside an agents\' computer, not this machine',
  devices: 'a note to the person\'s own devices; nothing leaves the hive',
  hub: 'a hub service or job, started or stopped again from the panel',
  work: 'work in the hive, stopped from the missions bar or the work chat',
  none: 'no automatic way back',
};

const reads = (actions, rest = { tier: 'reversible', way: WAY.none }) => [{ when: { action: actions }, tier: 'read' }, rest];

const TOOLS = {
  write_file: [{ tier: 'reversible', way: WAY.backup, touches: true }],
  replace_in_files: [{ when: { apply: true }, tier: 'reversible', way: WAY.none, touches: true }, { tier: 'read' }],
  git: reads(['status', 'log', 'diff', 'show', 'branches'], { tier: 'reversible', way: 'git keeps the commits; a project checkpoint covers the files', touches: true }),
  project: reads(['info', 'list', 'checkpoints', 'changes', 'worktree_status', 'open'],
    { when: { action: ['run', 'restore', 'worktree_remove'] }, tier: 'reversible', way: WAY.project, touches: true }).concat([{ tier: 'reversible', way: WAY.project }]),
  shell_job: reads(['status', 'output', 'list'], { tier: 'reversible', way: WAY.hub }),
  skill: reads(['list', 'read', 'file', 'search'], { tier: 'reversible', way: 'a skill is a file in the skills folder; shipped skills are never overwritten' }),
  canvas: reads(['read', 'list', 'preview'], { tier: 'reversible', way: 'a canvas keeps its revisions' }),
  recipe: reads(['list', 'show'], { tier: 'reversible', way: 'a recipe keeps its earlier revisions; each step of a run is classified itself' }),
  work_chats: reads(['list', 'read', 'recall'], { tier: 'reversible', way: WAY.work }),
  work_plan: reads(['read'], { tier: 'reversible', way: WAY.proposal }),
  schedule: reads(['list'], { tier: 'reversible', way: WAY.proposal }),
  hub_command: reads(['list'], { tier: 'reversible', way: WAY.hub }),
  computer: reads(['list'], { tier: 'reversible', way: WAY.computer }),
  computer_look: [{ tier: 'read' }],
  model_scout: reads(['signals', 'roles', 'list'], { tier: 'reversible', way: WAY.proposal }),
  tool_note: reads(['list'], { tier: 'reversible', way: WAY.proposal }),
  pack: reads(['list'], { tier: 'reversible', way: 'a pack in the library; nothing is applied' }),
  panel_layout: reads(['show'], { tier: 'reversible', way: 'panel_layout undo' }),
  api_call: [
    { when: { method: NOT_GET, url: u => !owned(u) }, tier: 'outward', why: 'sends data to a service the owner does not run' },
    { when: { method: NOT_GET }, tier: 'reversible', way: 'an address the owner owns', },
    { tier: 'read' }],
  http_fetch: [{ when: { method: NOT_GET }, tier: 'outward', why: 'sends data out' }, { tier: 'read' }],
  secret_use: [{ tier: 'outward', why: 'hands a secret to a device' }],
  computer_login: [{ tier: 'outward', why: 'signs in on a site with a stored login' }],
  settings_propose: [{ tier: 'reversible', way: `${WAY.proposal}; a saved setting is checkpointed (Settings → System → Checkpoints)` }],
  install_propose: [{ tier: 'reversible', way: WAY.proposal }],
  spend_propose: [{ tier: 'reversible', way: WAY.proposal }],
  mcp_draft: [{ tier: 'reversible', way: WAY.proposal }],
  service_draft: [{ tier: 'reversible', way: WAY.proposal }],
  memory_write: [{ tier: 'reversible', way: WAY.memory }],
  memory_flag: [{ tier: 'reversible', way: WAY.memory }],
  memory_forget: [{ tier: 'reversible', way: WAY.none }],
  memory_rules_write: [{ tier: 'reversible', way: 'the rules can be put back to their defaults' }],
  tell_device: [{ tier: 'reversible', way: WAY.devices }],
  ask_device: [{ tier: 'reversible', way: WAY.devices }],
  remind: [{ tier: 'reversible', way: WAY.devices }],
  agent_dispatch: [{ tier: 'reversible', way: WAY.work }],
  agent_resume: [{ tier: 'reversible', way: WAY.work }],
  mcp_connect: [{ tier: 'reversible', way: 'the server is started or stopped again' }],
};

/** A connected account (connectors/tools.js): reading it is a read, anything else acts on the owner's account. */
const CONNECTOR = [{ when: { method: NOT_GET }, tier: 'outward', why: 'acts on the owner\'s account at an outside service' }, { tier: 'read' }];

/** A device's or a server's tool named for one of these does something nobody takes back (when it gives no annotations). */
const MCP_OUTWARD_NAME = /(^|_)(send|delete|remove|erase|wipe|format|pay|payment|purchase|buy|order|checkout|post|publish|submit|transfer|email|mail|message|sms|tweet|share|uninstall|drop|destroy)(_|$)/i;

/* ── shell ─────────────────────────────────────────────────────────────── */

/** Verbs that only read (each segment of a line must be one for the line to be a read). */
const READ_VERBS = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'rg', 'ag', 'wc', 'pwd', 'echo', 'printf',
  'which', 'where', 'whereis', 'whoami', 'id', 'date', 'uname', 'hostname', 'uptime', 'df', 'du', 'free', 'ps', 'top',
  'env', 'printenv', 'stat', 'file', 'tree', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp', 'jq', 'yq', 'awk', 'basename',
  'dirname', 'realpath', 'readlink', 'nproc', 'lscpu', 'lsblk', 'lsusb', 'lspci', 'ip', 'ifconfig', 'ss', 'netstat',
  'ping', 'dig', 'nslookup', 'host', 'nvidia-smi', 'sensors', 'test', 'true', 'false', 'sleep', 'md5sum', 'sha256sum',
  'Get-ChildItem', 'gci', 'Get-Content', 'gc', 'Get-Location', 'Get-Process', 'Select-String', 'Get-Item', 'Test-Path',
]);
/** Verbs that read only with some arguments: the line is a read when the test passes. */
const READ_IF = {
  git: s => /^git\s+(status|log|diff|show|branch(?!.*\s-[dDmM])|remote(\s+-v)?\s*$|rev-parse|ls-files|ls-remote|blame|describe|shortlog|reflog|config\s+--get|tag(\s+-l|\s*$))\b/.test(s),
  find: s => !/\s-(delete|exec|execdir|ok|fprint)\b/.test(s),
  sed: s => !/\s-i\b|\s--in-place\b/.test(s),
  docker: s => /^\S+\s+(ps|images|logs|inspect|version|info|stats)\b/.test(s),
  podman: s => /^\S+\s+(ps|images|logs|inspect|version|info|stats)\b/.test(s),
  systemctl: s => /^systemctl\s+(status|is-active|is-enabled|list-units|show)\b/.test(s),
  npm: s => /^npm\s+(ls|list|view|outdated|-v|--version|config\s+get)\b/.test(s),
  node: s => /^node\s+(-v|--version)\s*$/.test(s),
  python: s => /^python3?\s+(-V|--version)\s*$/.test(s),
  curl: s => !SENDS.test(s),
  wget: s => !/--post-(data|file)|--method/.test(s) && /\s-O\s*-|\s-q?O-|--spider/.test(s),
};

/** Deleting: outward unless every target is inside the project the conversation is bound to (a checkpoint covers it). */
const DELETE_VERBS = /^(rm|rmdir|shred|unlink|del|erase|rd|Remove-Item|ri)$/i;
/** Losing work in a folder (its working tree): like a delete of the current folder. */
const LOSES_WORK = /^git\s+(clean\s+.*-\w*f|reset\s+.*--hard|checkout\s+(--\s+)?\.(\s|$)|restore\s+(--\s+)?\.(\s|$)|stash\s+(drop|clear))/;

/** A request that carries data (curl/wget/PowerShell/gh api). */
const SENDS = /\s(-X\s*(POST|PUT|PATCH|DELETE)|--request\s+(POST|PUT|PATCH|DELETE)|-d\b|--data(-\w+)?\b|-F\b|--form\b|-T\b|--upload-file\b|--json\b|-Method\s+(Post|Put|Patch|Delete)\b|-Body\b|-InFile\b)/i;
const REQUEST_VERBS = /^(curl|wget|http|https|xh|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)$/i;

/** Segments that are outward whatever else is in the line: `{ re, why }`, tried on each segment from its verb. */
const SHELL_OUTWARD = [
  { re: /^git\s+push\b.*(\s--force(-with-lease)?\b|\s-f\b|\s--mirror\b|\s--delete\b|\s-d\b|\s\+\S|\s:\S)/, why: 'rewrites or deletes history on a remote (git push --force)' },
  { re: /^(mail|mailx|sendmail|mutt|msmtp|Send-MailMessage)\b/i, why: 'sends mail' },
  { re: /^(npm|yarn|pnpm)\s+publish\b|^twine\s+upload\b|^(docker|podman)\s+push\b|^cargo\s+publish\b|^gem\s+push\b/, why: 'publishes a package or an image' },
  { re: /^gh\s+(release\s+(create|delete|upload|edit)|repo\s+(delete|create|archive|rename)|pr\s+(create|merge|close|comment|review)|issue\s+(create|close|comment|delete)|gist\s+create)\b/, why: 'posts to GitHub where other people see it' },
  { re: /^gh\s+api\b.*\s(-X|--method)\s*(POST|PUT|PATCH|DELETE)/i, why: 'changes something through the GitHub API' },
  { re: /^(shutdown|reboot|poweroff|halt|Stop-Computer|Restart-Computer)\b/i, why: 'stops or restarts the machine' },
  { re: /^(mkfs(\.\w+)?|fdisk|parted|wipefs|diskpart|Format-Volume|Clear-Disk)\b|^dd\b.*\bof=/i, why: 'writes a disk directly' },
  { re: /^(docker|podman)\s+(volume\s+(rm|prune)|system\s+prune|rm\s+.*-\w*v)/, why: 'deletes a container\'s data' },
  { re: /^rsync\b.*\s--delete/, why: 'deletes files at the other end (rsync --delete)' },
];

module.exports = { TOOLS, CONNECTOR, MCP_OUTWARD_NAME, WAY, READ_VERBS, READ_IF, DELETE_VERBS, LOSES_WORK, SENDS, REQUEST_VERBS, SHELL_OUTWARD };
