'use strict';

/**
 * Mailbox names in IMAP's modified UTF-7 (RFC 3501 §5.1.3): "Entw&APw-rfe" is "Entwürfe". Folders are shown as
 * people named them and sent back to the server in its own spelling.
 */
const decode = name => String(name).replace(/&([^-]*)-/g, (_m, b) => (b === '' ? '&'
  : Buffer.from(b.replace(/,/g, '/'), 'base64').swap16().toString('utf16le')));

function encode(name) {
  return String(name).replace(/&/g, '&-').replace(/[^\x20-\x7e]+/g, run => {
    const buf = Buffer.from(run, 'utf16le').swap16();
    return `&${buf.toString('base64').replace(/=+$/, '').replace(/\//g, ',')}-`;
  });
}

module.exports = { decode, encode };
