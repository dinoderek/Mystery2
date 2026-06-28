#!/usr/bin/env bash
# One-shot Claude CLI wrapper for the runtime eval harness.
#
#   $1 — system prompt file (role "strict JSON API" instruction)
#   $2 — user message file   (JSON.stringify({ prompt, context }))
#
# stdout — the Claude Code JSON envelope. The harness extract_path is "result",
#          so the model's reply (which must be the role JSON) is read from there.
#
# Model is taken from RUNTIME_EVAL_MODEL, else the cli.json "model" is passed by
# the harness via the env it sets; default to sonnet.
set -euo pipefail

SYS_FILE="${1:?missing system prompt file}"
USER_FILE="${2:?missing user message file}"
MODEL="${RUNTIME_EVAL_MODEL:-sonnet}"

claude --print \
  --output-format json \
  --model "$MODEL" \
  --append-system-prompt "$(cat "$SYS_FILE")" \
  "$(cat "$USER_FILE")"
