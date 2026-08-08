'use strict';
/**
 * script-sandbox.js — shared harness for the CLI regression tests.
 *
 * Every script test does the same three things: build a throwaway repo root
 * containing a copy of the script under test (plus scripts/lib, which the
 * scripts require), write fixture files into it, and run the script with the
 * sandbox as cwd. This module owns that setup so the tests only describe the
 * fixture and the expected output.
 */

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB_DIR = __dirname;

const sandboxes = [];

/**
 * Create a throwaway repo root with `scripts/<script>` copied in alongside
 * scripts/lib, and `dirs` (repo-relative paths) pre-created.
 * Returns the sandbox root; call removeSandboxes() to clean up.
 */
function createSandbox({ script, dirs = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-test-'));
  sandboxes.push(root);

  const scriptsDir = path.join(root, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.cpSync(LIB_DIR, path.join(scriptsDir, 'lib'), { recursive: true });
  fs.copyFileSync(script, path.join(scriptsDir, path.basename(script)));

  for (const dir of dirs) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  return root;
}

/** Write `content` to a sandbox-relative path, creating parent directories. */
function writeFile(root, relativePath, content) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** Write `value` as pretty-printed JSON to a sandbox-relative path. */
function writeJson(root, relativePath, value) {
  return writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

/** Run a sandboxed script with the sandbox as cwd; returns the spawnSync result. */
function runScript(root, scriptName, args = []) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', scriptName), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

/** Remove every sandbox created so far. Safe to call from afterEach. */
function removeSandboxes() {
  for (const root of sandboxes.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = {
  createSandbox,
  writeFile,
  writeJson,
  runScript,
  removeSandboxes,
};
