'use strict';

/**
 * Canvases: a page the agent opens, writes into and keeps (modules/canvas).
 * It reaches the chat as a chip that opens it; the page itself runs only on the
 * canvas origin, sandboxed, where it can reach nothing.
 */
const { resolvePath } = require('./common');

function htmlFrom({ html, path: p }, ctx = {}) {
  if (html != null && String(html).trim()) return String(html);
  if (p) return require('fs').readFileSync(resolvePath(p, ctx), 'utf8');
  throw new Error('Give the page as `html`, or a `path` to an .html file.');
}

/** The chip in the chat: the canvas and the revision this message is about. */
function chip(c, ctx) {
  const rev = c.revisions.at(-1).rev;
  if (typeof ctx.show === 'function') {
    ctx.show({ kind: 'canvas', name: `${c.id}@${rev}`, canvasId: c.id, rev, caption: c.title });
  }
  return rev;
}

module.exports = [
  {
    name: 'canvas',
    description: 'A page in a window beside the chat, for anything that reads better laid out than as text: a '
      + 'small tool made for the task, a table to sort, a diagram, a report, a form. `open` makes one from a whole '
      + 'HTML document and shows it to the user as a button in the chat; `write` replaces its page with a new '
      + 'revision (earlier ones are kept, so messages that pointed at them still open what they showed); `read` '
      + 'returns a page; `list` the canvases of this conversation. The page runs sandboxed on its own origin: '
      + 'inline scripts and styles work, and scripts or styles from cdn.jsdelivr.net and cdnjs.cloudflare.com, '
      + 'but it cannot fetch anything or load remote images — put data and images in the page (data: URLs). It '
      + 'can hand text back with parent.postMessage({ doca: "send", text }, "*"), which puts the text in the '
      + 'user\'s chat box for them to send. `preview` shows a server running on this machine — a dev '
      + 'server, a served project — by its port: the user gets a button that opens it in the same window, from '
      + 'any device on the tailnet, even when it listens on localhost only. Good for 12 hours.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'write', 'read', 'list', 'preview'] },
        port:   { type: 'integer', description: 'For preview: the localhost port the server listens on.' },
        at:     { type: 'string', description: 'For preview: the path to open, e.g. /docs. Default /.' },
        id:     { type: 'string', description: 'The canvas, for write and read.' },
        title:  { type: 'string', description: 'For open (and optionally write): a few words.' },
        html:   { type: 'string', description: 'The whole page, <!doctype html> and all.' },
        path:   { type: 'string', description: 'Instead of html: an .html file on this machine.' },
        rev:    { type: 'integer', description: 'For read: a revision; the latest when omitted.' },
      },
      required: ['action'],
    },
    run: (args, ctx = {}) => {
      const canvases = require('../../canvas/store');
      switch (args.action) {
        case 'open': {
          const c = canvases.create({ title: args.title, html: htmlFrom(args, ctx), sessionId: ctx.sessionId || null });
          chip(c, ctx);
          return `Opened canvas ${c.id} ("${c.title}"); the user has a button for it in the chat. Change it with write.`;
        }
        case 'write': {
          const c = canvases.get(args.id);
          if (!c) throw new Error(`No canvas "${args.id}". list shows this conversation's.`);
          const next = canvases.write(c.id, { html: htmlFrom(args, ctx), title: args.title });
          const rev = chip(next, ctx);
          return `Canvas ${c.id} is at revision ${rev}; the chat has a button for it.`;
        }
        case 'read': {
          const c = canvases.get(args.id);
          const html = c && canvases.page(c, args.rev);
          if (!html) throw new Error(`No canvas "${args.id}"${args.rev ? ` revision ${args.rev}` : ''}.`);
          return require('./common').clip(html);
        }
        case 'list': {
          const rows = canvases.list({ sessionId: ctx.sessionId });
          return rows.length
            ? rows.map(c => `${c.id} — ${c.title} (revision ${c.revisions.at(-1).rev}, ${c.updatedAt})`).join('\n')
            : 'No canvases in this conversation yet.';
        }
        case 'preview': {
          const p = require('../../canvas/previews').create({ port: args.port, title: args.title, sessionId: ctx.sessionId || null });
          const at = String(args.at || '/').startsWith('/') ? String(args.at || '/') : `/${args.at}`;
          if (typeof ctx.show === 'function') ctx.show({ kind: 'canvas', name: p.id, previewId: p.id, at, caption: p.title });
          return `Preview ${p.id} of localhost:${p.port} is a button in the chat; it works for ${require('../../canvas/previews').TTL_H} hours.`;
        }
        default: throw new Error('action is one of open, write, read, list, preview.');
      }
    },
  },
];
