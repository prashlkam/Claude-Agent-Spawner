#!/usr/bin/env bash
# PostToolUse · matcher: Write
#
# Claude Code pipes the hook payload to stdin as JSON. Exit 0 to allow, exit 2 to block
# with the message on stderr. This script runs on the user's machine with their
# permissions — review it before installing the plugin.
set -euo pipefail

payload="$(cat)"
export CLAUDE_HOOK_PAYLOAD="$payload"

npx markdownlint "$(jq -r '.tool_input.file_path' <<<"$payload")" || true
