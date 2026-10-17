// The end of a run: won or lost, the score, and what next.
import { W, H } from '../config.js';
import { menu, text } from '../systems/ui.js';
import { play } from '../systems/audio.js';

export default class End extends Phaser.Scene {
  constructor() { super('End'); }
  init(data = {}) { this.won = !!data.won; }

  create() {
    this.add.image(0, 0, 'sky').setOrigin(0);
    text(this, W / 2, 130, this.won ? 'You did it!' : 'Game over', 60, this.won ? '#ffe082' : '#ef9a9a');
    text(this, W / 2, 210, `Score ${this.registry.get('score') ?? 0} · Coins ${this.registry.get('coins') ?? 0}`, 26);
    play(this.won ? 'win' : 'lose');
    this.tick = menu(this, [
      { label: 'Play again', pick: () => this.scene.start('Game', { level: 0, newGame: true }) },
      { label: 'Menu', pick: () => this.scene.start('Menu', { page: 'main' }) },
    ], { y: 300 });
  }

  update() { this.tick(); }
}
