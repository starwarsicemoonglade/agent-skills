#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  createSandbox,
  writeFile,
  runScript,
  removeSandboxes,
} = require('./lib/script-sandbox');

const VALIDATOR = path.join(__dirname, 'validate-skills.js');

const SECTIONS = ['## Overview', '## When to Use', '## Common Rationalizations', '## Red Flags', '## Verification'];

function makeSandbox({ withSkillsDir = true } = {}) {
  return createSandbox({ script: VALIDATOR, dirs: withSkillsDir ? ['skills'] : [] });
}

function writeSkill(root, dirName, { name = dirName, description = 'Does a thing. Use when doing that thing.', sections = SECTIONS, extra = '' } = {}) {
  const body = sections.map(s => `${s}\n\nBody.\n`).join('\n');
  writeFile(
    root,
    path.join('skills', dirName, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}${extra}`,
  );
}

function run(root) {
  return runScript(root, 'validate-skills.js');
}

afterEach(removeSandboxes);

test('passes and reports every conforming skill', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill');
  writeSkill(root, 'beta-skill');

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /✓ {2}alpha-skill/);
  assert.match(result.stdout, /✓ {2}beta-skill/);
  assert.match(result.stdout, /2 skills checked — 0 error\(s\), 0 warning\(s\) — PASSED/);
});

test('fails with the linter error when a skill is missing a required section', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', { sections: SECTIONS.filter(s => s !== '## Verification') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /✗ {2}alpha-skill/);
  assert.match(result.stdout, /ERROR: Missing required section: ## Verification/);
  assert.match(result.stdout, /1 skills checked — 1 error\(s\), 0 warning\(s\) — FAILED/);
});

test('fails when a skill directory has no SKILL.md', () => {
  const root = makeSandbox();
  fs.mkdirSync(path.join(root, 'skills', 'empty-skill'));

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ERROR: Missing SKILL\.md/);
  assert.match(result.stdout, /1 skills checked — 1 error\(s\), 0 warning\(s\) — FAILED/);
});

test('passes with warnings for a dead cross-reference', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', { extra: 'Use the `ghost-skill` skill next.\n' });

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /⚠ {2}alpha-skill/);
  assert.match(result.stdout, /WARN: {2}Dead cross-reference: `ghost-skill` is not a known skill/);
  assert.match(result.stdout, /1 skills checked — 0 error\(s\), 1 warning\(s\) — PASSED WITH WARNINGS/);
});

test('resolves cross-references against the skills present on disk', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', { extra: 'Use the `beta-skill` skill next.\n' });
  writeSkill(root, 'beta-skill');

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Dead cross-reference/);
});

test('tags allowlisted skills as exempt from section checks', () => {
  const root = makeSandbox();
  const dir = path.join(root, 'skills', 'using-agent-skills');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    '---\nname: using-agent-skills\ndescription: Routes work to skills. Use when starting a task.\n---\n\n# Router\n',
  );

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /✓ {2}using-agent-skills \(section checks exempt\)/);
});

test('ignores loose files in the skills directory', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill');
  fs.writeFileSync(path.join(root, 'skills', 'README.md'), '# Not a skill\n');

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 skills checked — 0 error\(s\), 0 warning\(s\) — PASSED/);
});

test('reports errors and warnings from multiple skills in one run', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', { description: 'Does a thing.' });
  writeSkill(root, 'beta-skill', { extra: 'Use the `ghost-skill` skill next.\n' });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /2 skills checked — 1 error\(s\), 1 warning\(s\) — FAILED/);
});

test('fails with a structured message when the skills directory is missing', () => {
  const root = makeSandbox({ withSkillsDir: false });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /ERROR: skills directory not found at /);
});

test('reports an unexpected failure as a single line instead of a stack trace', () => {
  const root = makeSandbox({ withSkillsDir: false });
  // A file where the validator expects a directory: existsSync passes, readdirSync throws.
  fs.writeFileSync(path.join(root, 'skills'), 'not a directory\n');

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /ERROR: validate-skills failed unexpectedly: /);
  assert.doesNotMatch(result.stderr, /at Object\./);
});
