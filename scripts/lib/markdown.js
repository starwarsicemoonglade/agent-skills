'use strict';
/**
 * markdown.js — shared markdown primitives for the repo's validators.
 *
 * The frontmatter block at the top of a SKILL.md, a persona, or a Claude
 * slash-command file is parsed the same way everywhere: one regex for the
 * `---` delimited block, then `key: value` lines with surrounding quotes
 * stripped. Keeping one implementation here means a fix (CRLF handling,
 * quote stripping, EOF-terminated blocks) lands for every consumer at once.
 */

const fs = require('fs');

// Frontmatter block: `---` on its own line, content, closing `---`.
// The trailing newline is optional so a file that is nothing but
// frontmatter still parses.
const FRONTMATTER_BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Parse YAML-style frontmatter from the top of a markdown file.
 * Returns a key→value object, or null if no frontmatter block is found.
 * Values are trimmed and stripped of surrounding quotes.
 */
function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) return null;

  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key   = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Read a markdown file and return its parsed frontmatter (or null).
 * Throws whatever fs.readFileSync throws — callers decide how to report it.
 */
function readFrontmatter(filePath) {
  return parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Strip fenced code blocks from markdown content so that headings,
 * references, and trigger phrases inside examples or templates are not
 * matched by lint rules.
 */
function stripFencedCodeBlocks(content) {
  return content.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
}

module.exports = {
  parseFrontmatter,
  readFrontmatter,
  stripFencedCodeBlocks,
};
