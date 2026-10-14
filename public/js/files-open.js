/* ═══════════════════════════════════════════════════════
   Hub → Files: opening a folder with the mouse.

   A click on a row selects it (Ctrl and Shift add to the selection), and a double-click opens it — but nothing on
   the page said so, and the only hints were the keyboard's, so a newcomer with a mouse could not get into a folder
   (newcomer run of 2026-10-14, a5). A folder's name is now a link, as in a file manager's sidebar: one click on the
   name opens it, a click anywhere else on the row still selects, and the hint line names both.
   ═══════════════════════════════════════════════════════ */

/** A click on a folder's name: open it, unless a modifier asks to add to the selection instead. */
function fmOpenByName(event, path) {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return;   // the row's own click selects
  event.stopPropagation();
  if (fm.cwd === path) return;   // the second click of a double-click, while the folder loads
  fmNavigate(path);
}
