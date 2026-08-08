#!/bin/bash
# agent-skills session start hook
# Injects the using-agent-skills meta-skill into every new session
#
# Every failure path must still print one valid JSON payload: a hook that dies
# silently (or prints half a payload) leaves the session with no meta-skill and
# no explanation of why.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$(dirname "$SCRIPT_DIR")/skills"
META_SKILL="$SKILLS_DIR/using-agent-skills/SKILL.md"

if ! command -v jq >/dev/null 2>&1; then
  echo '{"priority": "INFO", "message": "agent-skills: jq is required for the session-start hook but was not found on PATH. Install jq (e.g. `brew install jq` or `apt-get install jq`) to enable meta-skill injection. Skills remain available individually."}'
  exit 0
fi

if [ ! -f "$META_SKILL" ]; then
  echo '{"priority": "INFO", "message": "agent-skills: using-agent-skills meta-skill not found. Skills may still be available individually."}'
  exit 0
fi

if ! CONTENT=$(cat "$META_SKILL" 2>&1); then
  printf '%s\n' "agent-skills: cannot read $META_SKILL: $CONTENT" >&2
  echo '{"priority": "INFO", "message": "agent-skills: the using-agent-skills meta-skill could not be read (see hook stderr). Skills may still be available individually."}'
  exit 0
fi

# Use jq to properly escape and construct valid JSON. Buffer it so a jq failure
# cannot emit a truncated payload on stdout.
if ! PAYLOAD=$(jq -cn \
  --arg message "agent-skills loaded. Use the skill discovery flowchart to find the right skill for your task.

$CONTENT" \
  '{priority: "IMPORTANT", message: $message}' 2>&1); then
  printf '%s\n' "agent-skills: jq failed to build the session-start payload: $PAYLOAD" >&2
  echo '{"priority": "INFO", "message": "agent-skills: could not build the meta-skill payload (see hook stderr). Skills may still be available individually."}'
  exit 0
fi

printf '%s\n' "$PAYLOAD"
