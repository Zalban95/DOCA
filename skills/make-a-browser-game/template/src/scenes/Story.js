// A story beat (story.js): its lines one at a time; a tap, Enter or Space shows the next, then the scene it leads to.
import { W, H } from '../config.js';
import { STORY } from '../story.js';
import { text } from '../systems/ui.js';
import { input } from '../systems/input.js';
import { play } from '../systems/audio.js';

export default class Story extends Phaser.Scene {
  constructor() { super('Story'); }
  init(data = {}) { this.beat = STORY[data.beat] || { lines: [] }; this.then = data.then || { scene: 'Menu' }; this.at = -1; }

  create() {
    this.add.image(0, 0, 'sky').setOrigin(0).setAlpha(0.6);
    if (this.beat.title) text(this, W / 2, 90, this.beat.title, 44, '#ffe082');
    this.lines = [];
    text(this, W / 2, H - 40, 'Tap, Enter or Space to continue', 18, '#cfd8dc');
    this.input.on('pointerup', () => this.advance());
    this.advance();
  }

  advance() {
    play('select');
    this.at += 1;
    if (this.at >= this.beat.lines.length) return this.scene.start(this.then.scene, this.then.data);
    const t = text(this, W / 2, 180 + this.at * 56, this.beat.lines[this.at], 26).setAlpha(0).setWordWrapWidth(W - 120);
    this.tweens.add({ targets: t, alpha: 1, duration: 300 });
  }

  update() { if (input.down.confirm || input.down.jump) this.advance(); }
}
