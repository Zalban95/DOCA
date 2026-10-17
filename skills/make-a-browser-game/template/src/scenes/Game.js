// A level being played: builds the map from its rows (legend.js), spawns its entities (entities/index.js), runs the
// player, and decides the level's end — complete() at an exit, a life lost at a fall or no health, the game over.
import { W, H, TILE, LIVES } from '../config.js';
import { LEVELS } from '../levels/index.js';
import { LEGEND, STAND } from '../levels/legend.js';
import { ENTITIES } from '../entities/index.js';
import { STORY } from '../story.js';
import Player from '../entities/Player.js';
import { input } from '../systems/input.js';
import { play, music } from '../systems/audio.js';
import { texture } from '../systems/art.js';
import { finished } from '../systems/save.js';
import { text } from '../systems/ui.js';

const oneWay = (a, p) => a.body.velocity.y >= 0 && a.body.bottom <= p.body.top + 10;

export default class Game extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data = {}) {
    this.levelIndex = Phaser.Math.Clamp(data.level ?? 0, 0, LEVELS.length - 1);
    this.level = LEVELS[this.levelIndex];
    this.ended = false;
    if (data.newGame || this.registry.get('lives') == null) this.registry.set({ lives: LIVES, score: 0, coins: 0 });
  }

  create() {
    const rows = this.level.rows;
    this.size = { w: rows[0].length * TILE, h: rows.length * TILE };
    this.physics.world.setBounds(0, 0, this.size.w, this.size.h + 400);
    this.physics.world.setBoundsCollision(true, true, false, false);   // walls at the sides, no floor: a fall is a fall
    this.bg = [this.level.sky || this.level.worldSky || 'sky', this.tile('hills-far'), this.tile('hills-near')]
      .map((k, i) => this.add.tileSprite(0, 0, W, H, texture(this, k, W, H)).setOrigin(0).setScrollFactor(0).setDepth(-10 + i));

    this.solids = this.physics.add.staticGroup();
    this.platforms = this.physics.add.staticGroup();
    this.spikes = this.physics.add.staticGroup();
    this.pickups = this.physics.add.staticGroup();
    this.marks = this.physics.add.staticGroup();
    this.groups = { enemy: this.add.group(), item: this.add.group(), hazard: this.add.group(), solid: this.add.group() };
    let start = { x: TILE * 2, y: TILE * 4 };
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      const x = c * TILE + TILE / 2, y = (r + 1) * TILE;   // the bottom centre of the cell
      const what = LEGEND[ch] || (/[a-z]/.test(ch) ? 'spawn' : 'empty');
      if (what === 'ground') this.solids.create(x, y - TILE / 2, this.tile(r > 0 && rows[r - 1][c] === '#' ? 'dirt' : 'ground'));
      else if (what === 'platform') this.platforms.create(x, y - TILE + 6, this.tile('platform'));
      else if (what === 'spikes') { const s = this.spikes.create(x, y - TILE / 2, this.tile('spikes')); s.body.setSize(26, 14); s.body.setOffset(3, 18); }
      else if (what === 'coin' || what === 'heart') this.pickups.create(x, y - TILE / 2, what).setData('kind', what);
      else if (what === 'checkpoint' || what === 'exit') this.marks.create(x, y, what).setOrigin(0.5, 1).refreshBody().setData('kind', what);
      else if (what === 'start') start = { x, y };
      else if (what === 'spawn') this.spawn(this.level.spawns?.[ch], x, y, this.level.options?.[ch], ch);
    }));
    this.respawnAt = start;
    this.player = new Player(this, start.x, start.y);
    this.registry.set('health', this.player.health);

    const p = this.player, { enemy, item, hazard, solid } = this.groups;
    this.physics.add.collider(p, this.solids);
    this.physics.add.collider(p, this.platforms, null, oneWay);
    this.physics.add.collider(p, solid);
    this.physics.add.collider(enemy, this.solids);
    this.physics.add.collider(enemy, this.platforms, null, oneWay);
    this.physics.add.collider(enemy, solid);
    this.physics.add.overlap(p, this.spikes, (pl, s) => pl.hurt(s));
    this.physics.add.overlap(p, hazard, (pl, h) => (h.touch ? h.touch(pl) : pl.hurt(h)));
    this.physics.add.overlap(p, enemy, (pl, e) => this.meet(e));
    this.physics.add.overlap(p, item, (pl, it) => it.touch?.(pl));
    this.physics.add.overlap(p, this.pickups, (pl, it) => this.pick(it));
    this.physics.add.overlap(p, this.marks, (pl, m) => this.mark(m));

    this.sparks = this.add.particles(0, 0, 'spark', { speed: { min: 60, max: 240 }, lifespan: 500, scale: { start: 0.8, end: 0 }, emitting: false }).setDepth(20);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.size.w, this.size.h).startFollow(p, true, 0.15, 0.15).setDeadzone(120, 90);
    cam.fadeIn(250);
    this.scene.launch('HUD');
    this.events.once('shutdown', () => { this.scene.stop('HUD'); this.scene.stop('Pause'); });
    music(this.level.music || this.level.worldMusic || 'world1');
    const name = text(this, W / 2, H / 3, `${this.level.world ? `${this.level.world} — ` : ''}${this.level.name || `Level ${this.levelIndex + 1}`}`, 36).setScrollFactor(0).setDepth(30);
    this.tweens.add({ targets: name, alpha: 0, delay: 1400, duration: 500, onComplete: () => name.destroy() });
  }

  /** A world's own version of a picture when it has one ("ground-w2" for a world whose tiles are "w2"), else the plain one. */
  tile(key) {
    const t = this.level.tiles || this.level.worldTiles;
    return t && this.textures.exists(`${key}-${t}`) ? `${key}-${t}` : key;
  }

  /** Make one entity from the registry, into the group its kind says. */
  spawn(name, x, y, opts, ch) {
    const Cls = ENTITIES[name];
    if (!Cls) return console.error(`Level "${this.level.name}": "${ch}" names "${name}", which is not in entities/index.js`);
    const e = new Cls(this, x, y, opts || {});
    (this.groups[Cls.kind] || this.groups.enemy).add(e);
    return e;
  }

  update(time, delta) {
    if (input.down.pause && !this.ended) return this.pauseGame();
    this.player.update(time, delta);
    for (const g of Object.values(this.groups)) for (const e of g.getChildren()) e.update?.(time, delta);
    const sx = this.cameras.main.scrollX;
    this.bg.forEach((b, i) => { b.tilePositionX = sx * [0.05, 0.2, 0.45][i]; });
    if (!this.player.dead && this.player.y > this.size.h + 60) { this.player.health = 0; this.playerDied(); }
  }

  /** Whether a map cell under pixel (x, y) is something to stand on — for enemies that turn at ledges. */
  groundAt(x, y) { return STAND.has(this.level.rows[Math.floor(y / TILE)]?.[Math.floor(x / TILE)]); }

  meet(e) {
    if (e.touch) return e.touch(this.player);
    const p = this.player;
    if (p.body.velocity.y > 0 && p.body.bottom <= e.body.top + 14) { e.hit ? e.hit() : e.destroy(); p.bounce(); }
    else p.hurt(e);
  }

  pick(it) {
    if (it.getData('kind') === 'coin') { play('coin'); this.registry.set('coins', this.registry.get('coins') + 1); this.addScore(10); }
    else { play('powerup'); this.player.heal(1); }
    this.burst(it.x, it.y, 0xffd54f);
    it.destroy();
  }

  mark(m) {
    if (m.getData('kind') === 'exit') return this.complete();
    if (m.getData('reached')) return;
    m.setData('reached', true).setTint(0x80ff80);
    this.respawnAt = { x: m.x, y: m.y };
    play('checkpoint');
    this.burst(m.x, m.y - 40, 0x80ff80);
  }

  addScore(n) { this.registry.set('score', this.registry.get('score') + n); }
  burst(x, y, color = 0xffffff) { this.sparks.setParticleTint(color); this.sparks.explode(14, x, y); }
  shake() { this.cameras.main.shake(140, 0.008); }

  pauseGame() {
    if (this.ended) return;
    this.scene.pause();
    this.scene.launch('Pause');
  }

  playerDied() {
    const p = this.player;
    if (p.dead || this.ended) return;
    p.dead = true;
    p.body.enable = false;
    const lives = this.registry.get('lives') - 1;
    this.registry.set('lives', lives);
    play('lose');
    this.tweens.add({ targets: p, alpha: 0, angle: 180, duration: 500 });
    if (lives <= 0) return this.gameOver();
    this.time.delayedCall(800, () => {
      p.setPosition(this.respawnAt.x, this.respawnAt.y).setAlpha(1).setAngle(0);
      p.body.enable = true;
      p.body.velocity.set(0, 0);
      p.heal(99);
      p.dead = false;
      p.invulnUntil = this.time.now + 1000;
    });
  }

  /** The level is finished: score kept, the next level unlocked, then the story beat before the next one, or the end. */
  complete() {
    if (this.ended) return;
    this.ended = true;
    play('win');
    music(null);
    finished(this.levelIndex, this.registry.get('score'));
    this.physics.pause();
    text(this, W / 2, H / 2, 'Level complete!', 48, '#ffe082').setScrollFactor(0).setDepth(30);
    this.time.delayedCall(1200, () => this.next());
  }

  next() {
    const i = this.levelIndex + 1;
    if (i < LEVELS.length) {
      const beat = LEVELS[i].story;
      if (beat && STORY[beat]) this.scene.start('Story', { beat, then: { scene: 'Game', data: { level: i } } });
      else this.scene.start('Game', { level: i });
    } else if (STORY.ending) this.scene.start('Story', { beat: 'ending', then: { scene: 'End', data: { won: true } } });
    else this.scene.start('End', { won: true });
  }

  gameOver() {
    if (this.ended) return;
    this.ended = true;
    music(null);
    this.time.delayedCall(900, () => this.scene.start('End', { won: false }));
  }
}
