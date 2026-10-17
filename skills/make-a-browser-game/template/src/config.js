// The game's numbers, in one place. The level test (test/levels.test.js) reads the jump numbers from here, so a change
// to gravity or jump speed that makes a level impossible fails `npm test`.
export const TITLE = '__TITLE__';
export const W = 960;            // the game's own size; the page scales it to fit, centred
export const H = 540;
export const TILE = 32;
export const GRAVITY = 1400;

export const PLAYER = {
  run: 260,            // top speed, px/s
  accel: 2200,         // on the ground
  airAccel: 1400,
  friction: 2600,
  jump: 640,           // jump speed, px/s
  cutJump: 0.45,       // releasing jump early keeps this share of the rise: short hops and full jumps
  coyoteMs: 90,        // a jump still counts this long after leaving a ledge
  bufferMs: 120,       // a jump pressed this long before landing still happens
  maxFall: 900,
  health: 3,
  invulnMs: 1000,
};
export const LIVES = 3;

// What the level test may assume the player reaches: rows up and columns across in one jump (a little under the real
// physics, so a level that passes is comfortable).
const rise = PLAYER.jump * PLAYER.jump / (2 * GRAVITY);
const air = 2 * PLAYER.jump / GRAVITY;
export const REACH = { up: Math.floor(rise / TILE), across: Math.floor(PLAYER.run * air * 0.8 / TILE) };
