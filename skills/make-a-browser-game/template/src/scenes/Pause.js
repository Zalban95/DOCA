// Paused: resume, start the level again, or go back to the menu.
import { W, H } from '../config.js';
import { menu, text } from '../systems/ui.js';
import { input } from '../systems/input.js';
import { music } from '../systems/audio.js';

export default class Pause extends Phaser.Scene {
  constructor() { super('Pause'); }

  create() {
    this.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0).setInteractive();
    text(this, W / 2, 130, 'Paused', 48);
    const game = this.scene.get('Game');
    this.tick = menu(this, [
      { label: 'Resume', pick: () => this.resume() },
      { label: 'Restart level', pick: () => { this.scene.stop(); game.scene.restart({ level: game.levelIndex }); } },
      { label: 'Menu', pick: () => { music(null); game.scene.stop(); this.scene.start('Menu', { page: 'main' }); } },
    ], { y: 240 });
  }

  resume() { this.scene.stop(); this.scene.resume('Game'); }
  update() { if (input.down.pause) this.resume(); else this.tick(); }
}
