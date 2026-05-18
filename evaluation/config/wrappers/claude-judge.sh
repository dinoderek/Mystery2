#!/usr/bin/env bash
# Wrapper invoked by the evaluation pipeline for the "judge" step.
#
# Args:
#   $1 — path to a file containing the system prompt (judge-system.md +
#         dimension definition concatenated)
#   $2 — path to a file containing the user message (brief + blueprint JSON)
#
# Contract: see claude-generate.sh.

set -euo pipefail

SYSTEM_PROMPT_FILE="$1"
USER_MESSAGE_FILE="$2"

claude \
  --print \
  --output-format json \
  --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
  < "$USER_MESSAGE_FILE"
