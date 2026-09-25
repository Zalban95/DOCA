'use strict';

/**
 * The front end as a test sees it: which scripts the page loads, in order, and
 * where a function lives.
 *
 * Tests used to read one named file (`utils.js`, `harness.js`) and cut a
 * function out of it with a regex, so moving a function to a better file broke
 * a test that had nothing to do with where it lived. Ask for the function by
 * name instead, and it is found in whichever file defines it; ask for the page's
 * scripts, and the list comes from `index.html`, so it cannot drift from what
 * the browser actually loads.
 */
const fs   = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const JS     = path.join(PUBLIC, 'js');

/** Every local script `index.html` loads, in load order, relative to public/js. */
function scripts() {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
}

/** Every .js file under public/js, relative to it, whether the page loads it or not. */
function files(dir = JS) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? files(path.join(dir, e.name))
    : e.name.endsWith('.js') ? [path.relative(JS, path.join(dir, e.name))] : []);
}

/** One script's source. */
function read(file) {
  return fs.readFileSync(path.join(JS, file), 'utf8');
}

/** Several scripts joined in the order given, as one classic-script scope would see them. */
function source(...list) {
  return list.map(read).join('\n;\n');
}

/**
 * The source of top-level function `name`, from whichever file defines it —
 * from its `function` line to the first closing brace in column 0.
 */
function fn(name) {
  const re = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm');
  const hits = files().map(f => read(f).match(re)).filter(Boolean);
  if (hits.length !== 1) throw new Error(`function ${name} is defined in ${hits.length} front-end files, expected 1`);
  return hits[0][0];
}

module.exports = { JS, scripts, files, read, source, fn };
