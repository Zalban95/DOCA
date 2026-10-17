---
name: test-a-game
description: Prove a game works from its start screen to its ending — every level, both controls, no errors — with the game's own test hooks and a solver test, not a robot player written to play it. Use when a game is built and must be shown to work, for a play test, a play-through on keyboard and touch, or when an automated player keeps failing.
triggers: [play test, playtest, test the game, play it through, start to ending, game test, end to end game, the bot keeps dying, prova il gioco, testa il gioco, giocalo fino alla fine]
---

# Test a game

A person plays a game for fun; you prove that it works. Writing a robot player that presses keys at the right moment
is a project of its own — its timing fails on a jump the game allows, and the hours go into the robot instead of the
game (2026-10-17: a work chat spent 1 h 40 min patching one). Prove each part directly instead:

1. **Every level can be finished — by the game's own physics.** A test that walks each level's map with the game's
   numbers (jump height and reach from gravity and speed, gaps, moving platforms) and fails when a goal cannot be
   reached. It runs with the project's tests (`npm test`), so a later edit that makes a level impossible fails there.
2. **Every screen draws, in a real browser, with no error.** Serve it on this machine (serve-a-repository) and drive
   the page through a test hook the game exposes for this (`window.__game`, or the engine's own): open the title,
   start each level, put the player beside the goal and let the game finish it, reach the ending. A screenshot at each
   — title, every level, the ending — and the console's errors read. With Phaser: restart a running scene with
   `scene.restart(data)`; stopping and starting it in the same moment leaves it stopped.
3. **Both controls drive the same moves.** Keyboard: a real key press, then read the player's velocity or position
   from the game. Touch: a phone-sized page with touch on, a screenshot that shows the pads, a pointer down on one, and
   the same reading. You check that the control moves the player, not that a robot can win.
4. **Show it and hand it over.** The screenshots (`show_media`), the preview link (`canvas` preview) so the person can
   play it on their phone, and one line per thing proven — and what was not.

If a level truly cannot be finished, that is the game's bug: fix the map or the numbers, not a robot. If the hook does
not exist yet, add the smallest one (a global that exposes the game object) — it costs a line and saves hours.
