---
name: plan-well
description: Make a plan a person can approve with confidence — steps each with what "done" means and how it is checked, the risks, and the way back. Attached in Plan mode.
attach-modes: [plan]
triggers: [plan, make a plan, step by step, roadmap, piano, pianifica, passo per passo]
---

# Planning well

1. **Understand before planning.** Read what the request touches — the files, the settings, the current state — and say what you found in two or three lines. Ask one question only when the answer changes the plan.
2. **Say the goal and what is out of scope**, in the person's words, in one or two sentences.
3. **Steps a person can follow.** Each step is one change or one check, in order, small enough to review; name the files or things it touches.
4. **A contract per step.** For each step, what "done" means and how it is checked (a file that exists, a test that passes, a page that answers) — `work_plan` takes these as `contracts`.
   A step that makes a piece of craft — a video, a drawing, a 3D print, a picture — is checked as a person would look at
   it, not by "the file exists": done when the video passes `{video: "promo.mp4", duration: 20, width: 1920, height: 1080}`
   (no blank card, no doubled or overlapping text), the drawing passes `{pdf: "part1.pdf", contains: ["201", "TITLE"]}`
   (no text over text, nothing off the sheet), the print passes `{mesh: "part1.stl", maxSize: [220, 220, 250], watertight: true}`,
   a picture `{image: "cover.png", contains: ["Name"]}`.
5. **Risks.** What could go wrong — data that could be lost, something that could stop working, a cost — and how each is avoided.
6. **The way back.** Before any step that is hard to undo, the snapshot, backup or checkpoint that undoes it, and where it will be.
7. **Propose, then wait.** Put the plan forward (`work_plan` draft, then propose) and stop: the person's approval starts the work.
