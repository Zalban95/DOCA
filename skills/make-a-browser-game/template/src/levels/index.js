// Every level, in play order: the worlds' lists one after another. scripts/plan.js writes it from docs/plan.json; each
// world owns its own folder and its index.js, so the people making different worlds never edit the same file.
import WORLD1 from './world1/index.js';
import WORLD2 from './world2/index.js';
import WORLD3 from './world3/index.js';

export const WORLDS = [WORLD1, WORLD2, WORLD3].filter(w => w.levels.length);
export const LEVELS = WORLDS.flatMap(w => w.levels.map(l => ({ ...l, world: w.name, worldMusic: w.music, worldSky: w.sky, worldTiles: w.tiles })));
