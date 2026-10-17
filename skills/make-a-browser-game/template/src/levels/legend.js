// What each character of a level's map means. A level's own letters (a–z) name entities in its `spawns`.
// Keep this file as it is: every level and the level test read it.
export const LEGEND = {
  '.': 'empty', ' ': 'empty',
  '#': 'ground',      // solid
  '=': 'platform',    // one-way: stand on it, jump up through it
  '^': 'spikes',      // hurts
  'o': 'coin',
  'h': 'heart',       // gives back one health
  'C': 'checkpoint',
  'P': 'start',       // exactly one
  'E': 'exit',        // at least one
};
export const SOLID = new Set(['#']);
export const STAND = new Set(['#', '=']);
