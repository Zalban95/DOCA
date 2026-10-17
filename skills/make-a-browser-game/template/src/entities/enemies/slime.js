// The pattern for an enemy: walks, turns at walls and ledges, dies to a stomp.
import { texture } from '../../systems/art.js';
import { play } from '../../systems/audio.js';

export default class Slime extends Phaser.Physics.Arcade.Sprite {
  static kind = 'enemy';

  constructor(scene, x, y, opts = {}) {
    super(scene, x, y, texture(scene, 'slime', 30, 22));
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.body.setSize(26, 18).setOffset(2, 4);
    this.speed = opts.speed || 60;
    this.setVelocityX(-this.speed);
  }

  update() {
    if (!this.body) return;
    const b = this.body;
    if (b.blocked.left) this.setVelocityX(this.speed);
    else if (b.blocked.right) this.setVelocityX(-this.speed);
    else if (b.blocked.down && !this.scene.groundAt(b.center.x + Math.sign(b.velocity.x) * 16, b.bottom + 4)) this.setVelocityX(-b.velocity.x);
    this.setFlipX(b.velocity.x > 0);
    this.scaleY = 1 + Math.sin(this.scene.time.now / 120) * 0.06;
  }

  hit() {
    play('stomp');
    this.scene.burst(this.x, this.y - 10, 0xab47bc);
    this.scene.addScore(100);
    this.destroy();
  }
}
