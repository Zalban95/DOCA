// Every kind of thing a level can spawn, by the name its `spawns` use. Keep this file as it is: each family (enemies,
// items, bosses) owns its own folder and its own index.js, so the people making them never edit the same file.
//
// An entity is a class made with (scene, x, y, opts) — x, y the bottom centre of its map cell, opts what the level
// gave — that adds itself to the scene (scene.add.existing, scene.physics.add.existing). Its static `kind` says how the
// game treats it:
//   'enemy'   collides with the ground; the player stomps it from above (it gets hit()), else it hurts the player —
//             unless it has touch(player), which then decides
//   'item'    touch(player) when the player reaches it (it destroys itself when used)
//   'hazard'  hurts the player on touch
//   'solid'   the player and enemies stand on it (a moving platform, a crate)
// When it has them, the game calls update(time, delta) every frame and hit() when the player stomps it.
// The scene gives entities: scene.player, scene.addScore(n), scene.burst(x, y, color), scene.shake(), scene.level.
import ENEMIES from './enemies/index.js';
import ITEMS from './items/index.js';
import BOSSES from './bosses/index.js';

export const ENTITIES = { ...ENEMIES, ...ITEMS, ...BOSSES };
