'use strict';

/**
 * The YAML reader for OpenAPI documents (api-services/yaml.js; no dependency). Checked during development against
 * PyYAML on eleven published specifications — the OpenAPI examples, Swagger 2's petstore, Spotify's, Twilio's,
 * OpenAI's (4 MB) and GitHub's (10 MB) — with the same result but for YAML 1.1's timestamps, which it keeps as text.
 * These are the shapes those documents use.
 */
require('./helpers');   // first, as every test (it points the settings at a temporary folder)
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, read } = require('../modules/api-services/yaml');

test('block scalars, keep and strip, folding and an indentation indicator', () => {
  assert.deepEqual(parse('a: |\n  one\n    two\n\n  three\nb: >-\n  folded\n  line\n\n  para\nc: |+\n  kept\n\nd: |2\n    indented\n'),
    { a: 'one\n  two\n\nthree\n', b: 'folded line\npara', c: 'kept\n\n', d: '  indented\n' });
});

test('quoted scalars over lines, escapes, comments, flow collections over lines', () => {
  assert.deepEqual(parse('a: "one\n  two \\\n  three\\t\\u00e9"  # note\nb: \'it\'\'s\n  here\'\nc: [x, "y, z", {k: v}]\nd:\n  {\n    "p": [1,\n      2]\n  }\n'),
    { a: 'one two three\té', b: "it's here", c: ['x', 'y, z', { k: 'v' }], d: { p: [1, 2] } });
});

test('sequences of mappings, nested sequences, a sequence at its key\'s indent, quoted keys, anchors and merges', () => {
  assert.deepEqual(parse('list:\n- name: a\n  in: query\n- - 1\n  - 2\n"$ref": "#/x"\nbase: &b {type: string}\nuse:\n  <<: *b\n  format: binary\nn: [~, null, true, 1.5, -2, 0x]\n'),
    { list: [{ name: 'a', in: 'query' }, [1, 2]], $ref: '#/x', base: { type: 'string' }, use: { type: 'string', format: 'binary' }, n: [null, null, true, 1.5, -2, '0x'] });
});

test('JSON reads as JSON; what it cannot read is said with the line', () => {
  assert.deepEqual(read('{"openapi": "3.1.0"}'), { openapi: '3.1.0' });
  assert.throws(() => parse('a:\n  - x\n  y: 1\n'), /line 3/);
  assert.throws(() => parse('a: *nope'), /unknown alias/);
});
