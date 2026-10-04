'use strict';

/**
 * A picture, a sound or a file a tool returned, kept as an attachment so the agent can show it (show_media)
 * or read it; it used to arrive as the word "[image]" and be lost — a screenshot from a computer, a render
 * from Blender. Text that says where it went replaces the bytes, which never enter the transcript.
 */
function keep(c, server) {
  const blob = c.type === 'resource' ? c.resource : c;
  const data = blob?.data || blob?.blob;
  const mime = blob?.mimeType || 'application/octet-stream';
  if (!data) return c.type === 'resource' && blob?.text ? blob.text : `[${c.type}]`;
  try {
    const ext = (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    const base = blob.uri ? require('path').basename(String(blob.uri)) : `${server}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
    const a = require('../attachments').save(Buffer.from(data, 'base64'), base, { mime, from: `mcp:${server}` });
    return `[${c.type} ${mime}, ${a.bytes} bytes, saved as ${a.path} — show it with show_media]`;
  } catch (e) { return `[${c.type} not kept: ${e.message}]`; }
}

module.exports = { keep };
