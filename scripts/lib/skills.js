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
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (e) {
    const shown = path.relative(process.cwd(), skillsDir) || skillsDir;
    throw new Error(`cannot read skills directory ${shown} — ${e.message}`);
  }
  return entries
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
 * Load every skill whose SKILL.md carries a `name` and a `description`.
 * A skill that cannot be loaded is invisible to callers that route or rank
 * against descriptions, so unloadable SKILL.md files are returned as
 * `problems` rather than silently skipped — dropping one would turn a broken
 * skill into a green run. Directories with no SKILL.md at all are ignored
 * (validate-skills.js owns that check).
 * Returns { skills: [{ name, description, dir }], problems: [string] }.
 */
function loadSkills(skillsDir) {
  const skills = [];
  const problems = [];
  for (const dir of listSkillDirs(skillsDir)) {
    const file = skillFilePath(skillsDir, dir);
    if (!fs.existsSync(file)) continue;
    let fm;
    try {
      fm = readFrontmatter(file);
    } catch (e) {
      problems.push(`${dir}: SKILL.md is unreadable — ${e.message}`);
      continue;
    }
    if (!fm) {
      problems.push(`${dir}: SKILL.md has no YAML frontmatter, so the skill cannot be routed to`);
      continue;
    }
    if (!fm.name || !fm.description) {
      const missing = [!fm.name && 'name', !fm.description && 'description'].filter(Boolean).join(' and ');
      problems.push(`${dir}: SKILL.md frontmatter is missing ${missing}, so the skill cannot be routed to`);
      continue;
    }
    skills.push({ name: fm.name, description: fm.description, dir });
  }
  return { skills, problems };
}

module.exports = {
  listSkillDirs,
  skillFilePath,
  loadSkills,
};
