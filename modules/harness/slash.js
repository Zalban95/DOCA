'use strict';

/**
 * Slash commands typed in a chat (asked 2026-10-09): what a person tells the conversation itself rather than the
 * agent. Parsed once, here, on the hub — `agent.send()` and `agent.turn()` both ask before anything else — so the
 * floating chat, the Harness console, a Projects chat, a device (`POST /api/v1/harness/messages`, whose text is passed
 * on unchanged) and a linked Telegram chat all understand the same commands. No model is asked: the answer is a
 * sentence from here, written into the conversation after the command, and the agent reads both in later turns.
 *
 *   /loop <interval> [xN] <what to do>   a loop in this conversation (schedules/loop.js); /loop stop; /loop: what runs
 *   /compact                             fold the earlier exchanges into the summary now (turn/compact-choice.js)
 *   /skill <name>                        attach a skill to this chat; /skill -<name> detaches; /skill: what is attached
 *
 * Anything else that starts with "/" is an ordinary message (a path, "/etc/hosts is…").
 */
const memory = require('./memory');

const COMMANDS = [
  { name: 'loop', usage: '/loop 10m <what to do>', what: 'run it again in this chat every 10 minutes (or "self": as soon as a run ends) until it is done; /loop stop ends it' },
  { name: 'compact', usage: '/compact', what: 'fold the earlier messages of this chat into its summary now' },
  { name: 'skill', usage: '/skill <name>', what: 'attach a skill to this chat (/skill -<name> detaches it)' },
];
const RE = /^\/(loop|compact|skill)(?:\s+([\s\S]*))?$/i;

/** { name, args } when the message is a command, else null. */
function parse(message) {
  const m = RE.exec(String(message || '').trim());
  return m ? { name: m[1].toLowerCase(), args: String(m[2] || '').trim() } : null;
}

async function run({ name, args }, { sessionId, person }) {
  if (name === 'loop') {
    const loop = require('../schedules/loop');
    if (/^(stop|off|end|cancel)$/i.test(args)) return loop.stop(sessionId);
    if (!args) {
      const on = loop.forSession(sessionId);
      return on.length ? on.map(s => `⟳ ${s.message.slice(0, 80)} — ${require('../schedules/when').describe(s.when)}, run ${s.runs || 0} of ${s.max}`).join('\n')
        : `No loop runs in this chat. ${COMMANDS[0].usage}: ${COMMANDS[0].what}.`;
    }
    if (!person?.id) return 'A loop runs as somebody: sign in first.';
    return loop.start(sessionId, args, person).text;
  }
  if (name === 'compact') return (await require('./turn/compact-choice').now(sessionId, person)).text;
  const use = require('./skill-use');
  if (!args) {
    const r = use.resolve(sessionId);
    return r.skills.length ? `Attached to this chat: ${r.skills.map(x => `${x.name} (${x.where})`).join(', ')}.` : 'No skill is attached to this chat. /skill <name> attaches one.';
  }
  const off = args.startsWith('-'), skill = args.replace(/^-\s*|^remove\s+/i, '').split(/\s+/)[0];
  const r = use.setChat(sessionId, off ? { remove: [skill] } : { add: [skill] });
  return off ? `Detached ${skill} from this chat.` : `Attached ${skill} to this chat: its instructions go with every turn here from now on (${r.skills.length} attached).`;
}

/**
 * The command's answer as a finished turn's result ({ sessionId, text, steps: 0, command }), or null when the message
 * is not a command. The command and the answer are kept in the transcript, and screens showing it redraw.
 */
function intercept(options = {}) {
  const cmd = parse(options.message);
  if (!cmd) return null;
  const sessionId = options.sessionId || memory.activeSession().id;
  return (async () => {
    const person = require('./turn/client').withPerson(options.client, sessionId)?.user || null;
    let text;
    try { text = await run(cmd, { sessionId, person }); } catch (e) { text = `Not done: ${e.message}`; }
    memory.append(sessionId, { role: 'user', content: String(options.message).trim(), ...(options.client?.name ? { from: { id: options.client.id || null, name: options.client.name, formFactor: options.client.formFactor || options.client.kind || null } } : {}) });
    memory.append(sessionId, { role: 'assistant', content: text, command: cmd.name });
    try { options.emit?.({ type: 'text', text }); } catch { /* the sender may be gone */ }
    try { require('../live').changed('conversation', sessionId, 'row'); } catch { /* bookkeeping */ }
    return { sessionId, text, steps: 0, command: cmd.name };
  })();
}

module.exports = { COMMANDS, parse, intercept, run };
