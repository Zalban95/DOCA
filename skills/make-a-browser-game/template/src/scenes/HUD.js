// What the player needs to see while playing, drawn over the level: health, lives, coins, score, and a pause button
// big enough for a thumb. It reads the game's registry and redraws when a value changes.
import { W, PLAYER } from '../config.js';
import { text } from '../systems/ui.js';
import { input } from '../systems/input.js';

export default class HUD extends Phaser.Scene {
  constructor() { super('HUD'); }

  create() {
    this.hearts = Array.from({ length: PLAYER.health }, (_, i) => this.add.image(28 + i * 28, 28, 'heart'));
    this.lives = text(this, 28, 62, '', 20).setOrigin(0, 0.5);
    this.coins = text(this, W / 2, 28, '', 24);
    this.score = text(this, W - 90, 28, '', 24).setOrigin(1, 0.5);
    if (!input.touch) {   // a touch screen has its own pause button, thumb-sized, beside the game (index.html)
      const pause = this.add.rectangle(W - 36, 34, 52, 52, 0xffffff, 0.12).setStrokeStyle(2, 0xffffff, 0.5).setInteractive({ useHandCursor: true });
      text(this, W - 36, 34, 'II', 24);
      pause.on('pointerup', () => this.scene.get('Game').pauseGame());
    }
    this.draw();
    const on = () => this.draw();
    this.registry.events.on('changedata', on);
    this.events.once('shutdown', () => this.registry.events.off('changedata', on));
  }

  draw() {
    const r = this.registry;
    this.hearts.forEach((h, i) => h.setAlpha(i < (r.get('health') ?? 0) ? 1 : 0.2));
    this.lives.setText(`Lives ${r.get('lives') ?? 0}`);
    this.coins.setText(`● ${r.get('coins') ?? 0}`);
    this.score.setText(String(r.get('score') ?? 0).padStart(6, '0'));
  }
}
