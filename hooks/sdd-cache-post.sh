#!/bin/bash
# sdd-cache-post.sh — PostToolUse hook for WebFetch.
#
# After WebFetch, stores the response body in .claude/sdd-cache/<sha>.json
# with the current ETag / Last-Modified captured via a HEAD request so the
# pre hook can revalidate on the next fetch.
#
# Keyed by URL. The caller's prompt is stored as metadata (not part of the
# key) so a future cache hit can show what question produced the cached
# reading. Entries without ETag or Last-Modified are not cached.
#
# Dependencies: jq, curl, shasum (or sha256sum).

set -euo pipefail

command -v jq   >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0
command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 || exit 0

if [ -t 0 ]; then INPUT="{}"; else INPUT=$(cat); fi

# Debug logging: active when SDD_CACHE_DEBUG=1 is set, or when a sentinel
# file exists at .claude/sdd-cache/.debug. Toggle with `touch` / `rm`.
dbg() {
  local dir="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/sdd-cache"
  [ "${SDD_CACHE_DEBUG:-0}" = "1" ] || [ -f "$dir/.debug" ] || return 0
  mkdir -p "$dir"
  printf '%s [post] %s\n' "$(date -u +%FT%TZ)" "$*" >> "$dir/.debug.log"
}
dbg "fired, input=$(printf '%s' "$INPUT" | head -c 400)"

# Separate "input isn't JSON we understand" from "this call has no URL": both
# skip caching, but only the first one is a bug worth seeing in the log.
if ! URL=$(printf '%s' "$INPUT" | jq -r '.tool_input.url // empty' 2>&1); then
  dbg "hook input is not valid JSON ($URL), skipping cache write"
  exit 0
fi
PROMPT=$(printf '%s' "$INPUT" | jq -r '.tool_input.prompt // empty' 2>/dev/null || true)
if [ -z "$URL" ]; then dbg "no url in tool_input, exit"; exit 0; fi
dbg "url=$URL prompt=$(printf '%s' "$PROMPT" | head -c 80)"

# Only http(s) URLs are cacheable, and anything that could be read as a curl
# option (leading dash) or a non-web scheme (file:, gopher:) is refused rather
# than handed to curl.
case "$URL" in
  http://*|https://*) ;;
  *) dbg "unsupported url scheme, exit"; exit 0 ;;
esac

# WebFetch tool_response shape (Claude Code as of 2026-04): an object with
# keys bytes, code, codeText, durationMs, result, url — content lives at
# .result. The other keys (.output / .text / .content / .body) are kept as
# defensive fallbacks in case the shape changes; jq returns empty if none
# match. The string branch handles older/custom integrations.
TOOL_RESPONSE_TYPE=$(printf '%s' "$INPUT" | jq -r '.tool_response | type' 2>/dev/null || echo "unknown")
dbg "tool_response type=$TOOL_RESPONSE_TYPE keys=$(printf '%s' "$INPUT" | jq -r 'try (.tool_response | keys | join(",")) catch "n/a"' 2>/dev/null)"

CONTENT=$(printf '%s' "$INPUT" | jq -r '
  if (.tool_response | type) == "object" then
    (.tool_response.result
     // .tool_response.output
     // .tool_response.text
     // .tool_response.content
     // .tool_response.body
     // empty)
  elif (.tool_response | type) == "string" then
    .tool_response
  else
    empty
  end
' 2>/dev/null || true)

if [ -z "$CONTENT" ]; then
  dbg "could not extract content from tool_response, exit (shape unknown)"
  exit 0
fi
dbg "extracted content bytes=${#CONTENT}"

# Must match the pre hook: sha256(URL), first 32 hex chars.
hash_key() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | cut -c1-32
  else
    printf '%s' "$1" | sha256sum | cut -c1-32
  fi
}

CACHE_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/sdd-cache"
mkdir -p "$CACHE_DIR"
CACHE_FILE="$CACHE_DIR/$(hash_key "$URL").json"

# Capture validators from the origin. Follow redirects so they match the
# URL the agent actually talked to. Strip CR so awk's paragraph mode
# recognises blank separators between response blocks on a redirect chain.
HEAD_OUT=$(curl -sI -L --max-redirs 5 --max-time 5 \
  --proto '=http,https' --proto-redir '=http,https' \
  -- "$URL" 2>/dev/null | tr -d '\r' || true)
# Keep curl's exit status: a transient HEAD failure must not be mistaken for
# "the origin sent no validators", which would evict a still-revalidatable
# entry. Distinguish the two below.
HEAD_ERR=$(mktemp)
if HEAD_OUT=$(curl -sSI -L --max-time 5 "$URL" 2>"$HEAD_ERR"); then
  HEAD_OK=1
else
  HEAD_OK=0
fi
HEAD_OUT=$(printf '%s' "$HEAD_OUT" | tr -d '\r')
if [ "$HEAD_OK" != "1" ]; then
  dbg "HEAD request failed ($(tr -d '\n' < "$HEAD_ERR")); leaving any existing entry untouched and exit"
  rm -f "$HEAD_ERR"
  exit 0
fi
rm -f "$HEAD_ERR"

# Take only the final response's headers (last paragraph) to avoid picking
# up validators from intermediate 301/302 hops.
FINAL_HEADERS=$(printf '%s' "$HEAD_OUT" | awk '
  BEGIN { RS = ""; last = "" }
  { last = $0 }
  END { print last }
')

extract_header() {
  local name="$1"
  printf '%s' "$FINAL_HEADERS" | awk -v h="$name" '
    BEGIN { FS = ":" }
    tolower($1) == tolower(h) {
      sub(/^[^:]*:[ \t]*/, "")
      sub(/[ \t]+$/, "")
      print
      exit
    }
  '
}

ETAG=$(extract_header "ETag")
LAST_MOD=$(extract_header "Last-Modified")
dbg "HEAD etag=$ETAG last_modified=$LAST_MOD"

# The origin answered but offers nothing to revalidate against, so any stored
# entry can never be served again — drop it rather than keep dead bytes.
if [ -z "$ETAG" ] && [ -z "$LAST_MOD" ]; then
  dbg "no validator from origin, removing any stale entry and exit"
  rm -f "$CACHE_FILE"
  exit 0
fi

NOW=$(date +%s)

TMP="${CACHE_FILE}.$$.tmp"
if jq -n \
  --arg url           "$URL" \
  --arg prompt        "$PROMPT" \
  --arg etag          "$ETAG" \
  --arg last_modified "$LAST_MOD" \
  --arg content       "$CONTENT" \
  --argjson fetched_at "$NOW" \
  '{url: $url, prompt: $prompt, etag: $etag, last_modified: $last_modified, content: $content, fetched_at: $fetched_at}' \
  > "$TMP"
then
  mv "$TMP" "$CACHE_FILE"
  dbg "wrote cache file $CACHE_FILE"
else
  rm -f "$TMP"
  dbg "jq failed, temp cleaned"
fi

exit 0
