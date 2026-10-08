'use strict';

/**
 * A folder's tree, hard-linked into another: the same bytes under a second name, no download and no copy. It is how
 * an installed version shares node_modules with one whose dependencies are identical (modules/releases.js).
 *
 * It was `cp -al`, which is GNU's: Windows has no cp at all and macOS's BSD cp has no -l, so on both a version switch
 * fell through to npm (and on Windows that failed too — H1.9, a real Windows 11 host, 2026-10-08). Here it is Node's own
 * fs on every OS. Where a link cannot be made (another volume, a file system without hard links) the file is copied,
 * and a symbolic link is made again as one, so the result is always a whole tree.
 */
const fs = require('fs');
const path = require('path');

function linkTree(src, dest, { link = fs.linkSync } = {}) {
  let linked = 0, copied = 0;
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, e.name), b = path.join(to, e.name);
      if (e.isDirectory()) walk(a, b);
      else if (e.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(a), b);
      else {
        try { link(a, b); linked++; } catch { fs.copyFileSync(a, b); copied++; }
      }
    }
  };
  walk(src, dest);
  return { linked, copied };
}

module.exports = { linkTree };
