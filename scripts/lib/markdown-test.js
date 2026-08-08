#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseFrontmatter, stripFencedCodeBlocks } = require('./markdown');

test('parses keys, trims values, and strips surrounding quotes', () => {
  const fm = parseFrontmatter('---\nname: alpha-skill\ndescription: "Use when X"\n---\n\n# Body\n');

  assert.deepEqual(fm, { name: 'alpha-skill', description: 'Use when X' });
});

test('keeps colons inside a value', () => {
  const fm = parseFrontmatter('---\ndescription: Does X. Use when: Y happens\n---\n');

  assert.equal(fm.description, 'Does X. Use when: Y happens');
});

test('parses CRLF frontmatter and a block that ends at EOF', () => {
  assert.equal(parseFrontmatter('---\r\nname: a\r\n---\r\n').name, 'a');
  assert.equal(parseFrontmatter('---\nname: a\n---').name, 'a');
});

test('returns null when there is no frontmatter block', () => {
  assert.equal(parseFrontmatter('# Just a heading\n'), null);
  assert.equal(parseFrontmatter('---\nname: unterminated\n'), null);
});

test('strips fenced code blocks including longer fences', () => {
  const stripped = stripFencedCodeBlocks('before\n```md\n## Verification\n```\nafter\n');

  assert.equal(stripped.includes('## Verification'), false);
  assert.match(stripped, /before/);
  assert.match(stripped, /after/);
});
