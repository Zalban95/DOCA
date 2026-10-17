// The player: running with momentum, a jump you can cut short, a little grace at ledges (coyote time) and for early
// presses (jump buffer), a hurt flash with knock-back. Tune the numbers in config.js; add abilities here.
import { PLAYER } from '../config.js';
import { input } from '../systems/input.js';
import { play } from '../systems/audio.js';
import { texture } from '../systems/art.js';

export default class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, texture(scene, 'player', 28, 36));
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(10);
    this.body.setSize(20, 32).setOffset(4, 4).setMaxVelocityY(PLAYER.maxFall);
    this.health = PLAYER.health;
    this.lastGround = 0;
    this.lastJumpPress = -1e9;
    this.invulnUntil = 0;
    this.facing = 1;
    this.dead = false;
  }

  get onGround() { return this.body.blocked.down || this.body.touching.down; }

  update(time, delta) {
    if (this.dead) return;
    const dt = delta / 1000, b = this.body;
    const dir = (input.held.right ? 1 : 0) - (input.held.left ? 1 : 0);
    const accel = this.onGround ? PLAYER.accel : PLAYER.airAccel;
    if (dir) {
      b.velocity.x = Phaser.Math.Clamp(b.velocity.x + dir * accel * dt, -PLAYER.run, PLAYER.run);
      this.facing = dir;
    } else if (this.onGround) {
      const slow = PLAYER.friction * dt;
      b.velocity.x = Math.abs(b.velocity.x) <= slow ? 0 : b.velocity.x - Math.sign(b.velocity.x) * slow;
    }
    if (this.onGround) this.lastGround = time;
    if (input.down.jump) this.lastJumpPress = time;
    const canJump = time - this.lastGround <= PLAYER.coyoteMs;
    if (time - this.lastJumpPress <= PLAYER.bufferMs && canJump) {
      b.velocity.y = -PLAYER.jump;
      this.lastJumpPress = -1e9;
      this.lastGround = -1e9;
      play('jump');
      this.squash(0.8, 1.2);
    }
    if (!input.held.jump && b.velocity.y < 0) b.velocity.y *= 1 - (1 - PLAYER.cutJump) * Math.min(1, dt * 12);   // a short hop
    this.setFlipX(this.facing < 0);
    if (time < this.invulnUntil) this.alpha = Math.floor(time / 80) % 2 ? 0.35 : 1; else this.alpha = 1;
    if (this.onGround && !this.wasGround) this.squash(1.2, 0.8);
    this.wasGround = this.onGround;
  }

  squash(sx, sy) {
    this.scene.tweens.add({ targets: this, scaleX: { from: sx, to: 1 }, scaleY: { from: sy, to: 1 }, duration: 160, ease: 'Quad.out' });
  }

  /** A bounce off something stomped. */
  bounce(v = PLAYER.jump * 0.7) { this.body.velocity.y = -v; }

  /** Hurt by `from` (an enemy, a hazard): loses one health and is knocked back; false while still flashing. */
  hurt(from) {
    const now = this.scene.time.now;
    if (this.dead || now < this.invulnUntil) return false;
    this.health -= 1;
    this.invulnUntil = now + PLAYER.invulnMs;
    this.body.velocity.set((from && from.x > this.x ? -1 : 1) * 220, -320);
    play('hit');
    this.scene.shake();
    this.scene.registry.set('health', this.health);
    if (this.health <= 0) this.scene.playerDied();
    return true;
  }

  heal(n = 1) {
    this.health = Math.min(PLAYER.health, this.health + n);
    this.scene.registry.set('health', this.health);
  }
}
