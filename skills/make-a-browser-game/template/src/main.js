// Starts the game: the page's size and scaling (fit, centred), physics, the scenes, the controls, the test hook.
import { W, H, GRAVITY } from './config.js';
import { attach, update } from './systems/input.js';
import { hook } from './hook.js';
import Boot from './scenes/Boot.js';
import Menu from './scenes/Menu.js';
import Story from './scenes/Story.js';
import Game from './scenes/Game.js';
import HUD from './scenes/HUD.js';
import Pause from './scenes/Pause.js';
import End from './scenes/End.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0f1a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
  physics: { default: 'arcade', arcade: { gravity: { y: GRAVITY }, debug: false } },
  input: { activePointers: 3 },
  audio: { noAudio: true },   // sound is made by systems/audio.js
  scene: [Boot, Menu, Story, Game, HUD, Pause, End],
});
attach(() => setTimeout(() => game.scale.refresh(), 50));   // the pads took space: fit the game again
game.events.on('prestep', update);
window.__game = hook(game);
