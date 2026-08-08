'use strict';
/**
 * skills.js — one way to walk the skills/ directory.
 *
 * Both validators and the eval runner need the same two things: the list of
 * skill directories, and each skill's frontmatter (name + description).
 * They used to re-implement the readdir/statSync/frontmatter dance with
 * subtly different behaviour; this module is the single implementation.
 */

const fs   = require('fs');
const path = require('path');

const { readFrontmatter } = require('./markdown');

/** Sorted names of the directories directly under skillsDir. */
function listSkillDirs(skillsDir) {
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() || (entry.isSymbolicLink() &&
      fs.statSync(path.join(skillsDir, entry.name)).isDirectory()))
    .map(entry => entry.name)
    .sort();
}

/** Absolute path of a skill's SKILL.md (which may not exist). */
function skillFilePath(skillsDir, dirName) {
  return path.join(skillsDir, dirName, 'SKILL.md');
}

/**
 * Load every skill that has a readable SKILL.md with both `name` and
 * `description` in its frontmatter. Directories that are missing or
 * malformed are skipped — validate-skills.js is what reports those.
 * Returns [{ name, description, dir }] in directory order.
 */
function loadSkills(skillsDir) {
  const skills = [];
  for (const dir of listSkillDirs(skillsDir)) {
    const file = skillFilePath(skillsDir, dir);
    if (!fs.existsSync(file)) continue;
    const fm = readFrontmatter(file);
    if (fm && fm.name && fm.description) {
      skills.push({ name: fm.name, description: fm.description, dir });
    }
  }
  return skills;
}

module.exports = {
  listSkillDirs,
  skillFilePath,
  loadSkills,
};
