// Draws every texture once (art.js), then opens the menu.
import { makeAll } from '../systems/art.js';

export default class Boot extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    makeAll(this);
    this.scene.start('Menu');
  }
}
