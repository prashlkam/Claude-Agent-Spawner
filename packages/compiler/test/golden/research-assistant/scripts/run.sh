#!/usr/bin/env bash
# Headless runner for the `weekly-research-brief` agent, for use from cron or CI.
#
# Usage: run.sh "<prompt>"
#
# This executes Claude Code non-interactively on the invoking machine. It inherits your
# credentials and your permission settings — review it before scheduling it.
set -euo pipefail

PROMPT="${1:-Write this week's research brief on the topic in briefs/NEXT.md.}"

if [ -z "$PROMPT" ]; then
  echo "usage: run.sh \"<prompt>\"" >&2
  exit 64
fi

exec claude --agent weekly-research-brief --print "$PROMPT"
