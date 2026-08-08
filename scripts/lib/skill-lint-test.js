#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  parseFrontmatter,
  extractSkillReferences,
  lintSkillContent,
  lintSkill,
} = require('./skill-lint');

const sandboxes = [];

function makeSkillsDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-skill-lint-test-'));
  sandboxes.push(root);
  return root;
}

function writeSkill(skillsDir, dirName, content) {
  const dir = path.join(skillsDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

const SECTIONS = [
  '## Overview',
  '## When to Use',
  '## Common Rationalizations',
  '## Red Flags',
  '## Verification',
];

function skillContent({ name = 'example-skill', description = 'Does a thing. Use when doing that thing.', sections = SECTIONS, extra = '', frontmatterExtra = '' } = {}) {
  const fm = ['---', `name: ${name}`, `description: ${description}`];
  if (frontmatterExtra) fm.push(frontmatterExtra);
  fm.push('---');
  return `${fm.join('\n')}\n\n${sections.map(s => `${s}\n\nBody.\n`).join('\n')}${extra}`;
}

function lint(dirName, content, known = [dirName]) {
  return lintSkillContent(dirName, content, new Set(known));
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ─── parseFrontmatter ────────────────────────────────────────────────────────

test('parseFrontmatter returns key/value pairs and strips surrounding quotes', () => {
  const fm = parseFrontmatter('---\nname: example-skill\ndescription: "Use when linting"\n---\n\n# Body\n');

  assert.deepEqual(fm, { name: 'example-skill', description: 'Use when linting' });
});

test('parseFrontmatter handles CRLF line endings and trailing whitespace after the fences', () => {
  const fm = parseFrontmatter('--- \r\nname: example-skill\r\ndescription: Use when linting\r\n---\t\r\n\r\n# Body\r\n');

  assert.deepEqual(fm, { name: 'example-skill', description: 'Use when linting' });
});

test('parseFrontmatter keeps colons inside a value and ignores lines without a colon', () => {
  const fm = parseFrontmatter('---\nname: example-skill\nnotes\ndescription: Use when a: b\n---\n');

  assert.equal(fm.description, 'Use when a: b');
  assert.deepEqual(Object.keys(fm), ['name', 'description']);
});

test('parseFrontmatter returns null when there is no frontmatter block', () => {
  assert.equal(parseFrontmatter('# Just a heading\n\nSome prose.\n'), null);
});

// ─── extractSkillReferences ──────────────────────────────────────────────────

test('extractSkillReferences collects every supported reference form, deduplicated', () => {
  const refs = extractSkillReferences([
    'Use the `test-driven-development` skill first.',
    'Then follow the `code-review-and-quality` skill.',
    'You may invoke the `debugging-and-error-recovery` skill.',
    'When done, continue with `shipping-and-launch`.',
    'Also use `code-simplification` skill for cleanup.',
    'The `security-auditor` persona reviews it.',
    'For the breakdown, see `planning-and-task-breakdown`.',
    'spec ──→ incremental-implementation',
    '→ `frontend-ui-engineering`',
    'Use the `test-driven-development` skill again.',
  ].join('\n'));

  assert.deepEqual([...refs].sort(), [
    'code-review-and-quality',
    'code-simplification',
    'debugging-and-error-recovery',
    'frontend-ui-engineering',
    'incremental-implementation',
    'planning-and-task-breakdown',
    'security-auditor',
    'shipping-and-launch',
    'test-driven-development',
  ]);
});

test('extractSkillReferences ignores backticked strings that are not skill references', () => {
  const refs = extractSkillReferences('Run `npm test` and read `package.json` before shipping.');

  assert.equal(refs.size, 0);
});

test('extractSkillReferences is repeatable across calls (global regex state is reset)', () => {
  const content = 'Use the `test-driven-development` skill.';

  assert.deepEqual([...extractSkillReferences(content)], ['test-driven-development']);
  assert.deepEqual([...extractSkillReferences(content)], ['test-driven-development']);
});

// ─── lintSkillContent: frontmatter ───────────────────────────────────────────

test('lintSkillContent accepts a conforming skill', () => {
  const result = lint('example-skill', skillContent());

  assert.deepEqual(result, { errors: [], warnings: [], exempt: false });
});

test('lintSkillContent reports malformed frontmatter and stops there', () => {
  const { errors, warnings } = lint('example-skill', '# No frontmatter\n');

  assert.deepEqual(errors, ['Missing or malformed YAML frontmatter (expected --- block at top of file)']);
  assert.deepEqual(warnings, []);
});

test('lintSkillContent requires a name field', () => {
  const { errors } = lint('example-skill', '---\ndescription: Use when linting\n---\n' + SECTIONS.map(s => `${s}\n`).join('\n'));

  assert.ok(errors.some(e => e.includes("Frontmatter missing required field: 'name'")));
});

test('lintSkillContent requires the name to match the directory', () => {
  const { errors } = lint('example-skill', skillContent({ name: 'other-skill' }));

  assert.deepEqual(errors, ["Frontmatter name 'other-skill' does not match directory name 'example-skill'"]);
});

test('lintSkillContent rejects a directory name that is not kebab-case', () => {
  const { errors } = lint('Example_Skill', skillContent({ name: 'Example_Skill' }));

  assert.ok(errors.some(e => e.includes("Directory name 'Example_Skill' is not lowercase-hyphen-separated")));
});

test('lintSkillContent requires a description field', () => {
  const { errors } = lint('example-skill', '---\nname: example-skill\n---\n' + SECTIONS.map(s => `${s}\n`).join('\n'));

  assert.ok(errors.some(e => e.includes("Frontmatter missing required field: 'description'")));
});

test('lintSkillContent rejects a description over the 1024-char limit', () => {
  const description = `Use when ${'x'.repeat(1024)}`;

  const { errors } = lint('example-skill', skillContent({ description }));

  assert.deepEqual(errors, [
    `Description is ${description.length} chars — exceeds the 1024-char limit (agents inject this into the system prompt)`,
  ]);
});

test('lintSkillContent accepts a description exactly at the 1024-char limit', () => {
  const description = `Use when ${'x'.repeat(1024 - 'Use when '.length)}`;
  assert.equal(description.length, 1024);

  const { errors } = lint('example-skill', skillContent({ description }));

  assert.deepEqual(errors, []);
});

test('lintSkillContent requires a when-to-use trigger in the description', () => {
  const { errors } = lint('example-skill', skillContent({ description: 'Reviews code for quality problems.' }));

  assert.ok(errors.some(e => e.includes("Description has no 'when to use' trigger")));
});

for (const description of [
  'Reviews code. Use when opening a pull request.',
  'Reviews code. Use this when opening a pull request.',
  'Reviews code. Use before merging.',
  'Reviews code. Use after a failing build.',
  'Reviews code. Use during incident response.',
]) {
  test(`lintSkillContent accepts trigger phrasing: ${description}`, () => {
    const { errors } = lint('example-skill', skillContent({ description }));

    assert.deepEqual(errors, []);
  });
}

test('lintSkillContent rejects a description whose only trigger is negated', () => {
  const { errors } = lint('example-skill', skillContent({ description: 'Reviews code. Do not use when the build is red.' }));

  assert.ok(errors.some(e => e.includes("Description has no 'when to use' trigger")));
});

test('lintSkillContent accepts a description that pairs a negated clause with a real trigger', () => {
  const { errors } = lint('example-skill', skillContent({
    description: 'Reviews code. Use when opening a pull request. Do not use when the build is red.',
  }));

  assert.deepEqual(errors, []);
});

// ─── lintSkillContent: exemptions ────────────────────────────────────────────

test('lintSkillContent marks allowlisted skills exempt and skips section checks', () => {
  const content = '---\nname: using-agent-skills\ndescription: Routes work to skills. Use when starting a task.\n---\n\n# Router\n';

  const result = lint('using-agent-skills', content, ['using-agent-skills']);

  assert.deepEqual(result, { errors: [], warnings: [], exempt: true });
});

test('lintSkillContent rejects a skill that declares its own exemption', () => {
  const { errors, exempt } = lint('example-skill', skillContent({ frontmatterExtra: 'type: meta' }));

  assert.equal(exempt, false);
  assert.ok(errors.some(e => e.includes("declares 'type: meta' or 'exempt: sections'")));
});

test('lintSkillContent rejects a self-declared section exemption', () => {
  const { errors } = lint('example-skill', skillContent({ frontmatterExtra: 'exempt: sections' }));

  assert.ok(errors.some(e => e.includes('SECTION_EXEMPT_SKILLS allowlist')));
});

test('lintSkillContent allows the allowlisted meta-skill to declare type: meta', () => {
  const content = '---\nname: using-agent-skills\ndescription: Routes work. Use when starting a task.\ntype: meta\n---\n\n# Router\n';

  const { errors } = lint('using-agent-skills', content, ['using-agent-skills']);

  assert.deepEqual(errors, []);
});

// ─── lintSkillContent: sections ──────────────────────────────────────────────

test('lintSkillContent reports every missing required section', () => {
  const { errors } = lint('example-skill', skillContent({ sections: ['## Overview'] }));

  assert.deepEqual(errors, [
    'Missing required section: ## When to Use',
    'Missing required section: ## Common Rationalizations',
    'Missing required section: ## Red Flags',
    'Missing required section: ## Verification',
  ]);
});

test('lintSkillContent does not count headings inside fenced code blocks', () => {
  const content = skillContent({
    sections: SECTIONS.filter(s => s !== '## Verification'),
    extra: '```markdown\n## Verification\n\nTemplate only.\n```\n',
  });

  const { errors } = lint('example-skill', content);

  assert.deepEqual(errors, ['Missing required section: ## Verification']);
});

test('lintSkillContent does not accept a deeper heading level in place of a required section', () => {
  const content = skillContent({ sections: SECTIONS.filter(s => s !== '## Red Flags') })
    + '### Red Flags\n\nBody.\n';

  const { errors } = lint('example-skill', content);

  assert.deepEqual(errors, ['Missing required section: ## Red Flags']);
});

// ─── lintSkillContent: cross-references ──────────────────────────────────────

test('lintSkillContent warns about cross-references to unknown skills without failing', () => {
  const content = skillContent({ extra: 'Use the `nonexistent-skill` skill next.\n' });

  const { errors, warnings } = lint('example-skill', content);

  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, ['Dead cross-reference: `nonexistent-skill` is not a known skill']);
});

test('lintSkillContent does not warn when a cross-reference resolves to a known skill', () => {
  const content = skillContent({ extra: 'Use the `test-driven-development` skill next.\n' });

  const { warnings } = lint('example-skill', content, ['example-skill', 'test-driven-development']);

  assert.deepEqual(warnings, []);
});

// ─── lintSkill (filesystem wrapper) ──────────────────────────────────────────

test('lintSkill reads SKILL.md from disk and lints it', () => {
  const skillsDir = makeSkillsDir();
  writeSkill(skillsDir, 'example-skill', skillContent());

  const result = lintSkill('example-skill', skillsDir, new Set(['example-skill']));

  assert.deepEqual(result, { errors: [], warnings: [], exempt: false });
});

test('lintSkill reports a missing SKILL.md', () => {
  const skillsDir = makeSkillsDir();
  fs.mkdirSync(path.join(skillsDir, 'empty-skill'));

  const result = lintSkill('empty-skill', skillsDir, new Set(['empty-skill']));

  assert.deepEqual(result, { errors: ['Missing SKILL.md'], warnings: [], exempt: false });
});

test('lintSkill reports an unreadable SKILL.md instead of throwing', () => {
  const skillsDir = makeSkillsDir();
  // A directory named SKILL.md exists but cannot be read as a file.
  fs.mkdirSync(path.join(skillsDir, 'odd-skill', 'SKILL.md'), { recursive: true });

  const { errors, warnings, exempt } = lintSkill('odd-skill', skillsDir, new Set(['odd-skill']));

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Unreadable SKILL\.md: /);
  assert.deepEqual(warnings, []);
  assert.equal(exempt, false);
});
