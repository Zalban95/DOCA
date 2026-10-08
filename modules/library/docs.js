'use strict';

/**
 * A document's text, by whichever reader this machine has (library/media.js): text, Markdown, code and data files
 * read as they are; HTML without its tags; PDF through pdftotext; office files and EPUB through LibreOffice's
 * headless converter. What has no reader here comes back empty with a note saying which program reads it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('./media');

const MAX_TEXT = 2 * 1024 * 1024;   // the first 2 MB of text: past it a document is a book, read in its first part
const OFFICE = new Set(['.doc', '.docx', '.odt', '.rtf', '.ppt', '.pptx', '.odp', '.xls', '.xlsx', '.ods', '.epub']);

const strip = html => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ');

/** {text, note} for a document file. */
async function text(file, signal) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') {
    if (!M.have().pdftotext) return { text: '', note: 'PDF not read: pdftotext (poppler) is not installed' };
    try { return { text: (await M.run('pdftotext', ['-l', '200', '-enc', 'UTF-8', file, '-'], { timeoutMs: 120000, signal })).toString('utf8').slice(0, MAX_TEXT) }; }
    catch (e) { return { text: '', note: `PDF not read: ${e.message}` }; }
  }
  if (OFFICE.has(ext)) {
    if (!M.have().soffice) return { text: '', note: `${ext.slice(1)} not read: LibreOffice is not installed` };
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-library-'));
    try {
      await M.run(M.sofficeBin(), ['--headless', '--norestore', `-env:UserInstallation=file://${out.replace(/\\/g, '/')}/profile`,
        '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', out, file], { timeoutMs: 180000, signal });
      const txt = fs.readdirSync(out).find(n => n.endsWith('.txt'));
      return txt ? { text: fs.readFileSync(path.join(out, txt), 'utf8').slice(0, MAX_TEXT) } : { text: '', note: `${ext.slice(1)} not read: LibreOffice made no text` };
    } catch (e) { return { text: '', note: `${ext.slice(1)} not read: ${e.message}` }; }
    finally { fs.rmSync(out, { recursive: true, force: true }); }
  }
  let buf;
  const fd = fs.openSync(file, 'r');
  try { buf = Buffer.alloc(Math.min(MAX_TEXT, fs.fstatSync(fd).size)); fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
  if (buf.includes(0)) return { text: '', note: 'not read: it holds binary data' };
  const s = buf.toString('utf8');
  return { text: ext === '.html' || ext === '.htm' || ext === '.xml' ? strip(s) : s };
}

module.exports = { text, OFFICE, MAX_TEXT };
