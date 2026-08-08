#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { listSkillDirs, loadSkills, skillFilePath } = require('./skills');

const roots = [];

function makeSkillsDir(skills) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-skills-test-'));
  roots.push(root);
  for (const [name, body] of Object.entries(skills)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    if (body !== null) fs.writeFileSync(path.join(root, name, 'SKILL.md'), body);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('lists skill directories in sorted order and ignores loose files', () => {
  const root = makeSkillsDir({ beta: null, alpha: null });
  fs.writeFileSync(path.join(root, 'README.md'), 'not a skill\n');

  assert.deepEqual(listSkillDirs(root), ['alpha', 'beta']);
});

test('loads name and description, skipping malformed or missing SKILL.md', () => {
  const root = makeSkillsDir({
    alpha: '---\nname: alpha\ndescription: Handles alpha. Use when alpha changes.\n---\n',
    beta: '# No frontmatter\n',
    gamma: null,
  });

  assert.deepEqual(loadSkills(root), [
    { name: 'alpha', description: 'Handles alpha. Use when alpha changes.', dir: 'alpha' },
  ]);
});

test('skillFilePath points at the skill directory SKILL.md', () => {
  assert.equal(skillFilePath('/skills', 'alpha'), path.join('/skills', 'alpha', 'SKILL.md'));
});
