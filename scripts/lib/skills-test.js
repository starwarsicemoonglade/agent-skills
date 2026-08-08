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

test('loads name and description, reporting malformed SKILL.md and ignoring missing ones', () => {
  const root = makeSkillsDir({
    alpha: '---\nname: alpha\ndescription: Handles alpha. Use when alpha changes.\n---\n',
    beta: '# No frontmatter\n',
    delta: '---\nname: delta\n---\n',
    gamma: null,
  });

  const { skills, problems } = loadSkills(root);

  assert.deepEqual(skills, [
    { name: 'alpha', description: 'Handles alpha. Use when alpha changes.', dir: 'alpha' },
  ]);
  assert.deepEqual(problems, [
    'beta: SKILL.md has no YAML frontmatter, so the skill cannot be routed to',
    'delta: SKILL.md frontmatter is missing description, so the skill cannot be routed to',
  ]);
});

test('throws a descriptive error when the skills directory cannot be read', () => {
  assert.throws(() => listSkillDirs(path.join(os.tmpdir(), 'agent-skills-missing-dir')),
    /cannot read skills directory/);
});

test('skillFilePath points at the skill directory SKILL.md', () => {
  assert.equal(skillFilePath('/skills', 'alpha'), path.join('/skills', 'alpha', 'SKILL.md'));
});
