---
name: write-a-skill
description: Write or revise a skill (a procedure kept for next time) — use when you worked out how to do a kind of task and it will come back, or when asked to turn a conversation into a skill.
triggers: [write a skill, make a skill, turn this into a skill, scrivi una skill]
---

# Writing a skill

A skill is how to do a *kind* of thing — "ship an Android build", "file an expense in Zucchetti" — not a fact about this machine (that is memory) and not a note about one tool (that is `tool_note`). It costs a line in every prompt and its body only when loaded, so it earns its place by being reused.

1. **Check first.** Read the manifest in your prompt and `skill` action read any that is close. Revising one beats keeping two that disagree.
2. **Name the task, not the tool:** `ship-android-build`, not `gradle-notes`. Lower-case, digits and `-`.
3. **The description is the trigger.** One line, starting with what it does, then *when to use it*: the words a request will contain. The agent decides to load it from this line alone, so vague is invisible.
4. **The body is steps, in order,** each one something to do and how to check it worked:
   - preconditions (what must exist before step 1),
   - the commands or tool calls, with placeholders like `<project>` where values go — never a real client name, address, key or amount,
   - how to tell it worked, and the failure you hit last time with what fixed it.
5. **Short.** Under a page. What the model already knows (how git works) does not go in; what it got wrong on this task does.
6. **Keep it with `skill` action write,** then use it once on the next real task and correct it from what happened. A skill nobody has followed since writing it is a guess.

When the user asks for one from a conversation: say in two lines what you would keep, and write it after they agree.
