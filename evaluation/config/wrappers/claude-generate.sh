#!/usr/bin/env bash
# Wrapper invoked by the evaluation pipeline for the "generate" step.
#
# Args:
#   $1 — path to a file containing the system prompt (generator-prompt.md)
#   $2 — path to a file containing the user message (JSON: { story_brief, instructions })
#
# Contract:
#   Writes to stdout a single JSON object that the pipeline will parse and
#   then extract via cli.json's extract_path (default: ".result"). The
#   extracted string must itself be valid Blueprint V2 JSON.
#
# This default wrapper uses the `claude` CLI. Replace cmd in cli.json to use
# a different LLM CLI; the contract above is what the pipeline depends on.

set -euo pipefail

SYSTEM_PROMPT_FILE="$1"
USER_MESSAGE_FILE="$2"

claude \
  --print \
  --output-format json \
  --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
  < "$USER_MESSAGE_FILE"
