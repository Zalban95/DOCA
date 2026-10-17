---
name: make-a-browser-game
description: Make a browser game that plays on a phone and a desk — alone or with a team — from a tested starter (Phaser 3, no build step) whose page, controls, menus, saving, sound, pictures and browser test already work, and a plan file that lists every world, enemy, item, sound and story beat so the game's own test says what is still missing. Use for any 2D game request, a platformer, an arcade or adventure game, a game jam, or when a game came out poor, off-centre, or with controls over the view.
triggers: [browser game, make a game, build a game, platformer, phaser, game with a team, rich game, arcade game, 2d game, game jam, crea un gioco, fai un gioco, videogioco, gioco per telefono]
---

# Make a browser game

A game is judged in the first ten seconds: the page fits the screen, the controls fall under the thumbs, it feels
good to move, and there is a lot to discover. The starter beside this skill gets the first three right and tested, so
the work goes into the fourth — the content. Do not rebuild what it has.

## 1. Start from the starter, in a project

    node <this skill's folder>/scripts/new-game.js <workspace>/<game-name> --title "The Title"

It makes the folder a git repository with the starter as its first commit: the game centred and scaled on any screen;
on a touch screen big pads with space of their own (below the game held upright, beside it sideways) and a pause
button in a free corner; keyboard, gamepad and touch as one set of controls; title, level select, settings, pause,
story and end screens; levels as text maps; enemies and items in a registry; pictures and sounds made in code; saving;
`window.__game` for tests; `npm test` — every level checked finishable with the real jump, and the game played in a
real browser on a desk and a phone both ways (layout, every level, the ending, keyboard, touch, no errors), with
pictures in `test/shots/`. Then make it the project: `project` open with that folder — this conversation then works
in it. Read `docs/README.md` in it: which file does what, and how to add each thing.

## 2. Write the plan — sized to what the person asked

`docs/plan.json` (copy `docs/plan.example.json`) is the game's content as a list: worlds with their levels, look and
music, every enemy, item and boss with what it does, every picture, sound and tune, every story beat. Then
`node scripts/plan.js`: a stand-in file for each planned entity (so levels can use its name at once), each family's
and world's index. From then on `npm test` lists every planned thing not yet real as a todo, and `npm run test:full`
fails until none is left. The plan is the contract — a thin plan makes a thin game.

"A game" with nothing more said: one world of three levels, three enemies, two items. **"Rich", "full", "with lots of
features", "like a real one"** means at least: three worlds of three to four levels, each world its own look, music
and a new idea (a hazard, a mechanic, an enemy); six kinds of enemy that behave differently (walk, fly, shoot, jump,
chase, need an ability to beat); a boss; four power-ups or abilities (double jump, dash, shield, magnet…); coins plus
hidden gems in every level and a completion count; checkpoints; moving or crumbling platforms and springs; a story
beat for each world and an ending; a sound for every action and a tune for every world, the menu and the boss; and
feel — particles, screen shake, squash and stretch, parallax. Write it into `docs/design.md` in plain words too (one
paragraph per world, per enemy, per ability) for the team to read. Commit both.

## 3. The team — one owner per file, many at once

Ownership comes from the starter's layout, so parallel tasks never edit the same file. Twelve tasks fit one `team`
create (more go on with `team` add):

| Task | Owns | Done when |
| --- | --- | --- |
| player | `src/entities/Player.js`, `src/config.js` | every planned ability works and feels good: coyote time, buffered and variable jump kept |
| enemies | `src/entities/enemies/` | each planned enemy behaves as the plan says; none a stand-in |
| bosses | `src/entities/bosses/` | each boss has a health bar, phases and an end |
| items | `src/entities/items/` | each planned item and moving thing works |
| world1, world2, world3 | `src/levels/<world>/` | its planned levels, each finishable, each using the world's new idea, hidden gems placed |
| art | `src/systems/art.js` | every planned picture drawn in one palette; each world its own tiles and sky |
| audio | `src/systems/audio.js` | every planned sound and tune |
| ui | `src/scenes/` (Menu, HUD, Story, End, Pause), `src/story.js` | the screens look finished, the story's beats written, the HUD shows gems and abilities |
| integrate | — (all, after every task above) | `npm run test:full` passes on the merged game |
| review | — (after integrate) | a numbered list of what is wrong or missing, each with the file that owns it |

Every code task: `test: "npm test"` (its own part done; the other parts show as todo), a "done when" a person would
see, and the files it owns in its errand. Give integrate `test: "npm run test:full"`. The team's context says: read
`docs/README.md` and `docs/design.md` first; touch only your own files; after adding a file to a family or a level,
run `node scripts/plan.js`; never change `docs/plan.json` (say in your report what you would add); keep the code simple and the content rich (`ponytail` is about code, never about fewer
features); commit on your branch with a message that says why.

**integrate** starts from every branch merged (the hub merges them into its worktree and names any conflict). It fixes
the seams only — a name one task used and another spelled differently, a spawn with no entity — runs the full test,
and looks at every picture in `test/shots/`.

**review** is a tester: it follows `test-a-game` — plays every level through `window.__game`, looks at the pictures,
reads the plan and the design — and reports defects and missing features as a numbered list, each with its owner's
files. It fixes nothing.

## 4. Fix what the review found, on the same board

Read the review's list and put the fixes on the board with `team` add: one task per owner's files, after
`review`, and a last `final` task after them all with `test: "npm run test:full"`. One round is usually enough; a
second only for what the first did not fix.

## 5. Hand it over

Merge the final task's branch (`team` merge), start `npm start` as a background job (see `serve-a-repository`), open
it with `canvas` preview so the person can play on their phone, show the pictures from `test/shots/` with
`show_media`, and say in a few lines what each member made and what the review found.

## Never

- Rebuild the page, the controls or the test hook, or weaken `test/browser.test.js` to make it pass — a red layout
  test is a real problem on a real phone.
- Write a robot player to prove the game works: `test-a-game` says how.
- Do the team's work yourself while it runs, or start a second loop of tooling around the game. You lead: read
  `team` status, answer questions, add tasks.
