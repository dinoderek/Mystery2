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
#
# The model sees only the role prompt. `--system-prompt` replaces Claude Code's
# own system prompt instead of appending to it, and the remaining flags keep out
# its tools, MCP servers and settings, which include this repo's CLAUDE.md. The
# trace judge wrapper (evaluation/trace/config/wrappers/claude-trace-judge.sh)
# uses the same flags.
set -euo pipefail

SYS_FILE="${1:?missing system prompt file}"
USER_FILE="${2:?missing user message file}"
MODEL="${RUNTIME_EVAL_MODEL:-sonnet}"

claude --print \
  --output-format json \
  --model "$MODEL" \
  --system-prompt "$(cat "$SYS_FILE")" \
  --tools "" \
  --strict-mcp-config \
  --setting-sources "" \
  --no-session-persistence \
  < "$USER_FILE"
