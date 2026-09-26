---
name: make-a-specialist
description: Create a new specialist agent type (a definition the Orchestrator and work chats can dispatch) — use when a kind of errand keeps coming back.
---

# Making a specialist

A specialist is a small agent for one kind of errand: its role, a few **kits** of tools, and nothing else. Smaller is better — it pays for its prompt on every step.

1. **Name the errand**, not the model: `blender-engineer`, `invoice-reader`. Lower-case, digits and `-`.
2. **Write the definition** as markdown in the agents folder (`list_dir` the AGENTS_DIR from `settings_read`, or see an existing one with `read_file`):

   ```
   ---
   name: blender-engineer
   description: Builds and renders Blender scenes. Dispatch for 3D modelling and renders.
   kits: [files, shell, web]
   tools: [show_media]
   memory: false
   maxSteps: 12
   ---
   You are the Blender engineer. What you do, how, and what you hand back.
   ```

   - `description` is what the dispatcher reads to decide when to send it: say when.
   - `kits`: code, files, shell, canvas, web, memory, devices, panel, skills — a tool added to a kit later reaches it by itself. `tools` adds single tools.
   - It can never change settings, install, dispatch, or ask the person — those are removed if listed.
3. **Say what it hands back** in the role: the result, what it ran, what it did not verify.
4. **Try it** with one real errand (`agent_dispatch`) and read the result before relying on it.

If it would help every DOCA install, the person can promote it (the ⇪ button in its editor) so it ships with the next version.
