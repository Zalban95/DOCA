# __TITLE__ — how the game is made

Phaser 3, plain ES modules, no build step: `npm start` serves it at http://127.0.0.1:8080/, `npm test` checks it.

## Which file does what

| File | What it holds | Who changes it |
| --- | --- | --- |
| `index.html`, `style.css` | The page: the game centred and scaled; on touch screens the pads beside or below it, never over it | rarely — the layout is tested |
| `src/main.js` | Starts Phaser: size, scaling, physics, the list of scenes | when a scene is added |
| `src/config.js` | Every number: size, gravity, the player's run and jump, lives | the player's feel |
| `src/scenes/Boot.js` | Draws every texture, then the menu | — |
| `src/scenes/Menu.js` | Title, Play/Continue, Levels, Settings | the menus and title screen |
| `src/scenes/Story.js` | A story beat's lines, one at a time | — (the words are in `story.js`) |
| `src/scenes/Game.js` | A level being played: the map, entities, the player, the camera, the level's end | the game rules |
| `src/scenes/HUD.js`, `Pause.js`, `End.js` | Health, lives, coins, score, pause button; the pause menu; won or lost | the interface |
| `src/entities/Player.js` | Running, jumping, being hurt; add abilities here | the player |
| `src/entities/enemies/`, `items/`, `bosses/` | One file per kind of thing, and an `index.js` per family naming them | one owner per family |
| `src/entities/index.js` | Joins the families — leave it as it is | nobody |
| `src/levels/world1/` … `world3/` | One file per level, and an `index.js` per world (its name, music, levels in order) | one owner per world |
| `src/levels/legend.js`, `index.js` | What each map character means; every level in order — leave them as they are | nobody |
| `src/story.js` | The story beats, by name | the story |
| `src/systems/art.js` | Every texture, drawn in code, one palette | the art |
| `src/systems/audio.js` | Every sound effect and tune, made in code | the sound |
| `src/systems/input.js` | Keyboard, gamepad and touch as one set of controls | when a control is added |
| `src/systems/save.js`, `ui.js` | Progress and settings; menu buttons | rarely |
| `src/hook.js` | `window.__game`, how tests drive the game | when a test needs more |
| `test/levels.test.js` | Every level well formed and finishable with the player's jump | — |
| `test/browser.test.js` | The game in a real browser on a desk and a phone: layout, every level, the ending, keyboard, touch, no errors; pictures in `test/shots/` | — |

## How to add…

- **A level**: copy `src/levels/world1/level1.js` into its world's folder, draw its map (17 rows, legend in `legend.js`, its own
  letters in `spawns`), and add it to that world's `index.js`. `npm test` says whether it can be finished.
- **An enemy, an item, a boss**: copy `entities/enemies/slime.js` (or `items/gem.js`) into the family's folder, give it its
  `static kind`, and name it in the family's `index.js`. Levels spawn it by that name. Read the contract at the top of
  `entities/index.js`.
- **A picture**: an entry in `ART` (`systems/art.js`), drawn with Phaser's Graphics in the palette `PAL`. Until it exists, a
  magenta stand-in shows with a warning in the console.
- **A sound or a tune**: an entry in `SFX` or `TUNES` (`systems/audio.js`). An unknown name plays a blip.
- **A story beat**: an entry in `STORY` (`story.js`); a level names it in `story`, and `ending` plays after the last level.
- **A screen**: a scene in `src/scenes/`, listed in `main.js`.

Commit with a message that says why. Run `npm test` before you say you are done, and look at the pictures it leaves in
`test/shots/`.
