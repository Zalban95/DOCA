// The title screen: Play (from the furthest level reached), Levels, Settings. Pages are this scene restarted with
// another `page`, so each stays a plain list.
import { W, H, TITLE } from '../config.js';
import { LEVELS } from '../levels/index.js';
import { STORY } from '../story.js';
import { load, save } from '../systems/save.js';
import { music, setVolume } from '../systems/audio.js';
import { menu, text, button } from '../systems/ui.js';
import { input } from '../systems/input.js';

export default class Menu extends Phaser.Scene {
  constructor() { super('Menu'); }
  init(data = {}) { this.page = data.page || 'main'; }

  create() {
    for (const k of ['sky', 'hills-far', 'hills-near']) this.add.image(0, 0, k).setOrigin(0);
    const s = load();
    if (this.page === 'main') {
      const title = text(this, W / 2, 120, TITLE, 64, '#ffe082');
      this.tweens.add({ targets: title, y: 130, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      const from = Math.min(s.unlocked, LEVELS.length) - 1;
      this.tick = menu(this, [
        { label: from > 0 ? `Continue — level ${from + 1}` : 'Play', pick: () => this.play(from) },
        { label: 'Levels', pick: () => this.scene.restart({ page: 'levels' }) },
        { label: 'Settings', pick: () => this.scene.restart({ page: 'settings' }) },
      ], { y: 270 });
      text(this, W / 2, H - 28, 'Arrows / WASD to move · Space to jump · X for action · Esc to pause', 16, '#cfd8dc');
      music('menu');
    } else if (this.page === 'levels') {
      text(this, W / 2, 70, 'Levels', 44);
      const cols = 5, size = 96;
      const picks = LEVELS.map((l, i) => {
        const x = W / 2 + ((i % cols) - (Math.min(cols, LEVELS.length) - 1) / 2) * (size + 16), y = 170 + Math.floor(i / cols) * (size + 16);
        const open = i < s.unlocked;
        const b = button(this, x, y, open ? String(i + 1) : '🔒', () => open && this.play(i), { w: size, h: size, size: 32 });
        if (!open) b.box.setAlpha(0.4);
        return { b, open, i };
      });
      const back = button(this, W / 2, H - 70, 'Back', () => this.scene.restart({ page: 'main' }));
      let at = 0;
      const all = [...picks.map(p => p.b), back];
      const show = () => all.forEach((b, k) => b.focus(k === at));
      show();
      this.tick = () => {
        if (input.down.right) { at = Math.min(all.length - 1, at + 1); show(); }
        if (input.down.left) { at = Math.max(0, at - 1); show(); }
        if (input.down.down) { at = Math.min(all.length - 1, at + cols); show(); }
        if (input.down.up) { at = Math.max(0, at - cols); show(); }
        if (input.down.confirm || input.down.jump) all[at].onPick();
        if (input.down.pause) this.scene.restart({ page: 'main' });
      };
    } else {
      text(this, W / 2, 80, 'Settings', 44);
      const flip = key => () => { const st = load().settings; save({ settings: { ...st, [key]: !st[key] } }); if (key === 'music') music(null); this.scene.restart({ page: 'settings' }); };
      const vol = () => { const st = load().settings; const v = st.volume >= 1 ? 0.2 : Math.round((st.volume + 0.2) * 10) / 10; save({ settings: { ...st, volume: v } }); setVolume(v); this.scene.restart({ page: 'settings' }); };
      this.tick = menu(this, [
        { label: `Music: ${s.settings.music ? 'on' : 'off'}`, pick: flip('music') },
        { label: `Sound: ${s.settings.sfx ? 'on' : 'off'}`, pick: flip('sfx') },
        { label: `Volume: ${Math.round(s.settings.volume * 100)}%`, pick: vol },
        { label: 'Back', pick: () => this.scene.restart({ page: 'main' }) },
      ], { y: 190 });
    }
  }

  play(level) {
    music(null);
    const beat = LEVELS[level]?.story;
    const then = { scene: 'Game', data: { level, newGame: true } };
    if (beat && STORY[beat]) this.scene.start('Story', { beat, then });
    else this.scene.start(then.scene, then.data);
  }

  update() { this.tick?.(); }
}
