'use strict';

/**
 * Who the agent is, and who it works for — two files a person can open.
 *
 *   persona.md   the Orchestrator's identity: its manner, how it works with
 *                the person. What the organization does (levels, reports) is
 *                in code; this is character, and the agent may rewrite it.
 *   human.md     the person it works for, in their own words: how they like
 *                to be answered, what they are working on, what matters.
 *                Durable facts the agent learns stay in memory; this is the
 *                page the person keeps.
 *
 * The names are the Letta/MemGPT convention ("persona" and "human" core
 * blocks), and markdown, so importing from another harness — an OpenClaw
 * SOUL.md/USER.md, a Letta agent — is copying text. Both live in the data
 * folder (so every backup carries them) and are edited freely by the agent
 * and in Settings → Harness; neither is part of the control plane.
 *
 * Each is capped (CAP characters) — it is in every turn's prompt.
 */
const fs   = require('fs');
const path = require('path');
const store = require('../store');

const CAP = 6000;
const DEFAULT_PERSONA = `I am this panel's resident assistant — the one the person talks to, on their desk, phone or watch.
I am direct and brief: I say what I did and what I found, and what is theirs to decide.
I do small things myself and hand long work to a work chat, so I stay free for them.
When I am unsure, I check the machine rather than guess; when a choice is theirs, I ask once, with the options.`;

const file = name => path.join(store.dir('identity'), `${name}.md`);

function read(name) {
  try { return fs.readFileSync(file(name), 'utf8'); } catch { return null; }
}

function write(name, text) {
  if (!['persona', 'human'].includes(name)) throw Object.assign(new Error('persona or human'), { status: 400 });
  const t = String(text ?? '');
  if (t.length > CAP) throw Object.assign(new Error(`${name}.md is capped at ${CAP} characters — it is in every prompt.`), { status: 400 });
  fs.writeFileSync(file(name), t.trim() ? `${t.trim()}\n` : '', 'utf8');
  return get();
}

function get() {
  return { persona: read('persona') ?? DEFAULT_PERSONA, human: read('human') ?? '', personaIsDefault: read('persona') === null,
    paths: { persona: file('persona'), human: file('human') }, cap: CAP };
}

/** The prompt blocks. The persona is the Orchestrator's; the human block goes to it and to work chats. */
function personaBlock() {
  const t = (read('persona') ?? DEFAULT_PERSONA).slice(0, CAP).trim();
  return t ? `# Persona — who you are (yours to refine: ${file('persona')})\n${t}` : '';
}
function humanBlock() {
  const t = (read('human') || '').slice(0, CAP).trim();
  return t
    ? `# The person you work for (human.md — theirs; you may add what they tell you about themselves: ${file('human')})\n${t}`
    : `# The person you work for\nNothing written yet. When they tell you how they like to work, offer to keep it in ${file('human')}.`;
}

module.exports = { get, write, personaBlock, humanBlock, DEFAULT_PERSONA, CAP };
