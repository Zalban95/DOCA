// node scripts/plan.js — makes the files the plan (docs/plan.json) names, so everyone can use a name before its
// owner has made it real: a stand-in file for each planned enemy, item and boss (marked `static stub = true`, which
// test/plan.test.js counts as not done), each family's index.js and each world's index.js listing the files there,
// and src/levels/index.js listing the worlds. It never changes a file that exists except those index files — run it
// again after adding a file to a family or a level to a world.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(ROOT, ...p);
const plan = JSON.parse(fs.readFileSync(at('docs/plan.json'), 'utf8'));
const NAME = /^[a-z][a-z0-9-]*$/;
const cls = n => n.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');
const made = [];

const STUB = {
  enemies: (n, does) => `// ${cls(n)} — ${does || 'an enemy'}. A STAND-IN made by scripts/plan.js: make it behave as the plan says, then delete
// the \`static stub\` line. Copy what you need from slime.js.
import { texture } from '../../systems/art.js';

export default class ${cls(n)} extends Phaser.Physics.Arcade.Sprite {
  static kind = 'enemy';
  static stub = true;

  constructor(scene, x, y) {
    super(scene, x, y, texture(scene, '${n}', 30, 30));
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
  }

  hit() { this.scene.addScore(100); this.destroy(); }
}
`,
  items: (n, does) => `// ${cls(n)} — ${does || 'an item'}. A STAND-IN made by scripts/plan.js: make it do what the plan says, then delete
// the \`static stub\` line. Copy what you need from gem.js.
import { texture } from '../../systems/art.js';

export default class ${cls(n)} extends Phaser.Physics.Arcade.Image {
  static kind = 'item';
  static stub = true;

  constructor(scene, x, y) {
    super(scene, x, y - 16, texture(scene, '${n}', 20, 20));
    scene.add.existing(this);
    scene.physics.add.existing(this, true);
  }

  touch() { this.destroy(); }
}
`,
};
STUB.bosses = (n, does) => STUB.enemies(n, does).replace("static kind = 'enemy';", "static kind = 'enemy';\n  static boss = true;").replace('Copy what you need from slime.js.', 'A boss has a health bar, phases, and an end.');

for (const family of ['enemies', 'items', 'bosses']) {
  const dir = at('src/entities', family);
  fs.mkdirSync(dir, { recursive: true });
  for (const e of plan[family] || []) {
    if (!NAME.test(e.name)) throw new Error(`${family}: "${e.name}" — names are lowercase letters, digits and -`);
    const file = path.join(dir, `${e.name}.js`);
    if (!fs.existsSync(file)) { fs.writeFileSync(file, STUB[family](e.name, e.does)); made.push(path.relative(ROOT, file)); }
  }
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'index.js').map(f => f.slice(0, -3)).sort();
  fs.writeFileSync(path.join(dir, 'index.js'), `// The ${family}, by the name a level's spawns use — made by scripts/plan.js from the files here; run it again after adding one.\n`
    + names.map(n => `import ${cls(n)} from './${n}.js';`).join('\n') + `${names.length ? '\n' : ''}\nexport default { ${names.map(n => `'${n}': ${cls(n)}`).join(', ')} };\n`);
}

const worlds = plan.worlds || [];
for (const w of worlds) {
  if (!/^[a-z0-9-]+$/.test(w.folder || '')) throw new Error(`a world needs a folder name, like "world1"`);
  const dir = at('src/levels', w.folder);
  fs.mkdirSync(dir, { recursive: true });
  const levels = fs.readdirSync(dir).filter(f => /^level\d+\.js$/.test(f)).sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10));
  fs.writeFileSync(path.join(dir, 'index.js'), `// ${w.name}: its look, its music and its levels in play order — made by scripts/plan.js from docs/plan.json and the\n// level files here (level1.js, level2.js…); run it again after adding a level.\n`
    + levels.map((f, i) => `import level${i + 1} from './${f}';`).join('\n') + `${levels.length ? '\n' : ''}\nexport default { name: ${JSON.stringify(w.name)}, `
    + `music: ${JSON.stringify(w.music || 'world1')}, sky: ${JSON.stringify(w.sky || 'sky')}, tiles: ${JSON.stringify(w.tiles || '')}, levels: [${levels.map((_, i) => `level${i + 1}`).join(', ')}] };\n`);
}
if (worlds.length) fs.writeFileSync(at('src/levels/index.js'), `// Every level, in play order: the worlds' lists one after another — made by scripts/plan.js from docs/plan.json.\n`
  + worlds.map((w, i) => `import W${i + 1} from './${w.folder}/index.js';`).join('\n')
  + `\n\nexport const WORLDS = [${worlds.map((_, i) => `W${i + 1}`).join(', ')}].filter(w => w.levels.length);\n`
  + 'export const LEVELS = WORLDS.flatMap(w => w.levels.map(l => ({ ...l, world: w.name, worldMusic: w.music, worldSky: w.sky, worldTiles: w.tiles })));\n');
console.log(made.length ? `Stand-ins made: ${made.join(', ')}` : 'Every planned entity has its file.');
console.log('Index files written. npm test lists what the plan still needs.');
