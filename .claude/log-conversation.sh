#!/usr/bin/env bash
# Stop hook: rebuild a readable Markdown log of this session's conversation
# (user prompts + Claude's text replies) into claude-logs/ in the project.
set -euo pipefail
input=$(cat)
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
session=$(jq -r '.session_id // "unknown"' <<<"$input")
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

dir="${CLAUDE_PROJECT_DIR:-$(pwd)}/claude-logs"
mkdir -p "$dir"
# first(...) stops jq itself; piping into `head -1` breaks with pipefail (SIGPIPE) on long transcripts.
first_ts=$(jq -rn 'first(inputs | select(.type=="user" and .timestamp) | .timestamp) // empty' "$transcript" || true)
day=$(date -d "${first_ts:-now}" +%F 2>/dev/null || date +%F)
out="$dir/${day}_${session:0:8}.md"

{
  echo "# Claude Code session ${session}"
  echo
  jq -r '
    select((.type=="user" or .type=="assistant") and (.isMeta != true)) |
    ((.timestamp // "") | if . == "" then "" else (sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601 | localtime | strftime("%Y-%m-%d %H:%M:%S")) end) as $ts |
    if .type=="user" then
      (.message.content |
        if type=="string" then .
        else ([.[]? | select(.type=="text") | .text] | join("\n")) end) as $t |
      select(($t | length) > 0 and ($t | startswith("<") | not)) |
      "---\n\n## 🧑 You — \($ts)\n\n\($t)\n"
    else
      ([.message.content[]? | select(.type=="text") | .text] | join("\n")) as $t |
      select(($t | length) > 0) |
      "---\n\n## 🤖 Claude — \($ts)\n\n\($t)\n"
    end
  ' "$transcript"
} > "$out.tmp" && mv "$out.tmp" "$out"
