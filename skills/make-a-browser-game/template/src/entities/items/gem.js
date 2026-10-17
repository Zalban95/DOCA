// The pattern for an item: floats, and when the player reaches it, does its thing and goes.
import { texture } from '../../systems/art.js';
import { play } from '../../systems/audio.js';

export default class Gem extends Phaser.Physics.Arcade.Image {
  static kind = 'item';

  constructor(scene, x, y) {
    super(scene, x, y - 16, texture(scene, 'gem', 20, 20));
    scene.add.existing(this);
    scene.physics.add.existing(this, true);
    scene.tweens.add({ targets: this, y: this.y - 6, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }

  touch() {
    play('powerup');
    this.scene.addScore(500);
    this.scene.burst(this.x, this.y, 0x4dd0e1);
    this.destroy();
  }
}
