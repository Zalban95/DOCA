// window.__game: how a test (or a person in the browser's console) drives the game without playing it — what is on
// screen, where the player is, start any level, finish or lose it, hold a control. test/browser.test.js uses it; keep
// what it returns when you change the game, and add to it when a test needs more.
import { LEVELS } from './levels/index.js';
import { press } from './systems/input.js';

export function hook(game) {
  const active = () => game.scene.getScenes(true).map(s => s.scene.key);
  const level = () => game.scene.getScene('Game');
  const stopAll = () => { for (const k of active()) game.scene.stop(k); };
  return {
    game,
    active,
    levels: () => LEVELS.map(l => ({ name: l.name, world: l.world })),
    state() {
      const on = active(), g = level(), p = on.includes('Game') ? g.player : null;
      return { scenes: on, level: on.includes('Game') ? g.levelIndex : null, ended: on.includes('Game') ? g.ended : null,
        player: p ? { x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.body.velocity.x), vy: Math.round(p.body.velocity.y), onGround: p.onGround, health: p.health } : null,
        score: game.registry.get('score'), lives: game.registry.get('lives'), coins: game.registry.get('coins') };
    },
    start(i = 0) { stopAll(); game.scene.start('Game', { level: i, newGame: true }); },
    goto(key, data) { stopAll(); game.scene.start(key, data); },
    win() { level()?.complete(); },
    lose() { level()?.gameOver(); },
    press,
  };
}
