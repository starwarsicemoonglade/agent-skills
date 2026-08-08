#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');
const { materializeWorkspace } = require('./run-evals');

const {
  createSandbox,
  writeFile,
  writeJson,
  runScript,
  removeSandboxes,
} = require('./lib/script-sandbox');

const RUNNER = path.join(__dirname, 'run-evals.js');

function writeCase(root, skillName, value) {
  writeJson(root, path.join('evals', 'cases', `${skillName}.json`), value);
}

function writeSkill(root, name, description) {
  writeFile(
    root,
    path.join('skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

function behavioralEval(files = ['project/context.txt']) {
  return {
    id: 1,
    prompt: 'Inspect the attached project and complete the requested work.',
    expected_output: 'A verified result grounded in the attached project',
    files,
    expectations: ['The attached project is inspected before reporting a result'],
  };
}

function completeCase(skillName, positivePrompt, topK = 1, files) {
  return {
    skill_name: skillName,
    trigger: {
      positive: [1, 2, 3].map(() => ({ prompt: positivePrompt, top_k: topK })),
      negative: [
        { prompt: 'unrelated banana request' },
        { prompt: 'unrelated orange request' },
      ],
    },
    evals: [behavioralEval(files)],
  };
}

function makeSandbox() {
  const root = createSandbox({
    script: RUNNER,
    dirs: [path.join('evals', 'cases'), path.join('skills')],
  });
  writeFile(root, path.join('evals', 'fixtures', 'project', 'context.txt'), 'fixture\n');
  return root;
}

function run(root, args = []) {
  return runScript(root, 'run-evals.js', args);
}

afterEach(removeSandboxes);

test('fails when a skill has no eval case file', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no eval case file/);
});

test('fails when an eval case is below the required minimums', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');
  writeCase(root, 'alpha-skill', {
    skill_name: 'alpha-skill',
    trigger: {
      positive: [{ prompt: 'change alpha widget', top_k: 1 }],
      negative: [],
    },
    evals: [behavioralEval()],
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /below required minimums/);
});

test('fails when a behavioral eval references a missing fixture', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');
  writeCase(root, 'alpha-skill', completeCase('alpha-skill', 'change alpha widget', 1, ['missing/project.txt']));

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /fixture not found/);
});

test('requires fixtures for execution evals', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');
  writeCase(root, 'alpha-skill', completeCase('alpha-skill', 'change alpha widget', 1, []));

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /needs a non-empty files\[\] fixture list/);
});

test('allows dialogue evals without fixtures', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');
  const evalCase = completeCase('alpha-skill', 'change alpha widget');
  evalCase.evals = [{ ...behavioralEval([]), kind: 'dialogue' }];
  writeCase(root, 'alpha-skill', evalCase);

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects provisional execution evals', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');
  const evalCase = completeCase('alpha-skill', 'change alpha widget');
  evalCase.evals[0].trust_level = 'provisional';
  writeCase(root, 'alpha-skill', evalCase);

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /is still provisional/);
});

test('allows dialogue evals with a legacy provisional marker', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');
  const evalCase = completeCase('alpha-skill', 'change alpha widget');
  evalCase.evals = [{ ...behavioralEval([]), kind: 'dialogue', trust_level: 'provisional' }];
  writeCase(root, 'alpha-skill', evalCase);

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects unknown behavioral eval kinds', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');
  const evalCase = completeCase('alpha-skill', 'change alpha widget');
  evalCase.evals[0].kind = 'conversation';
  writeCase(root, 'alpha-skill', evalCase);

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /unknown kind "conversation"/);
});

test('dry-runs a fixtureless dialogue eval', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles alpha widgets. Use when changing alpha widgets.');
  const evalCase = completeCase('alpha-skill', 'change alpha widget');
  evalCase.evals = [{ ...behavioralEval([]), kind: 'dialogue' }];
  writeCase(root, 'alpha-skill', evalCase);

  const result = run(root, ['--behavioral', 'alpha-skill', '--dry-run']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /dialogue transcript/);
});

test('enforces the configured rank-1 floor', () => {
  const root = makeSandbox();
  writeSkill(root, 'alpha-skill', 'Handles widget work. Use when implementing widget changes.');
  writeSkill(
    root,
    'beta-skill',
    'Diagnoses urgent widget failures in production. Use when repairing urgent widget failures.',
  );
  writeCase(root, 'alpha-skill', completeCase('alpha-skill', 'urgent widget failure production', 2));
  writeCase(root, 'beta-skill', completeCase('beta-skill', 'repair urgent widget failure', 1));

  const passing = run(root, ['--min-rank1', '50']);
  const failing = run(root, ['--min-rank1', '60']);

  assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  assert.equal(failing.status, 1, failing.stdout + failing.stderr);
  assert.match(failing.stdout, /below required 60%/);
});

test('rejects an invalid rank-1 floor', () => {
  const root = makeSandbox();

  const result = run(root, ['--min-rank1', '101']);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /--min-rank1 must be a number from 0 to 100/);
});

test('materializes a git baseline and applies a working-tree patch', () => {
  const workspace = materializeWorkspace({ files: ['git-workflow-and-versioning'] });
  try {
    const status = spawnSync('git', ['status', '--short'], { cwd: workspace, encoding: 'utf8' });
    const commits = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: workspace, encoding: 'utf8' });

    assert.equal(status.status, 0, status.stdout + status.stderr);
    assert.match(status.stdout, / M git-workflow-and-versioning\/app\.js/);
    assert.equal(commits.stdout.trim(), '1');
    assert.equal(fs.existsSync(path.join(workspace, '.eval')), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
