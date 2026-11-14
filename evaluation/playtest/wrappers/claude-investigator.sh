#!/usr/bin/env bash
# One isolated Claude CLI call for the self-play investigator.
#
#   $1 — system prompt file (the investigator prompt with its persona)
#   $2 — user message file  (the player's view of the game)
#
# stdout — the Claude Code JSON envelope. The caller reads `structured_output`
#          from it, which `--json-schema` constrains to { plan, input }, so the
#          binding's extract_path is null.
#
# The model is EVAL_MODEL, which the evaluation core sets from the binding;
# sonnet when it is unset. CLAUDE_CLI_PATH names the `claude` executable, as it
# does for the game server's own claude-cli narrator.
#
# The flags are the ones the game server's claude-cli provider passes
# (packages/game-engine/src/ai-provider-claude-cli.ts): the system prompt
# replaces Claude Code's own, and its tools, MCP servers and settings, which
# include this repo's CLAUDE.md, stay out. It runs outside the repo for the same
# reason. A test compares the argument list with the one stored for the
# investigator snapshot (tests/api/unit/snapshots/evaluation/prompts).
#
# The reply field is `plan`, a note for the log, and not `thinking`: asking for
# the model's reasoning as output reads to the API's safeguards as reasoning
# extraction, and they refused about three turns in eight until it was renamed.
set -euo pipefail

SYS_FILE="${1:?missing system prompt file}"
USER_FILE="${2:?missing user message file}"
MODEL="${EVAL_MODEL:-sonnet}"
CLAUDE="${CLAUDE_CLI_PATH:-claude}"

SCHEMA='{"type":"object","properties":{"plan":{"type":"string"},"input":{"type":"string","minLength":1}},"required":["plan","input"],"additionalProperties":false}'

# The prompt files are absolute paths, so the working directory is free to move.
cd "${TMPDIR:-/tmp}"

exec "$CLAUDE" --print \
  --model "$MODEL" \
  --output-format json \
  --system-prompt "$(cat "$SYS_FILE")" \
  --tools "" \
  --strict-mcp-config \
  --setting-sources "" \
  --no-session-persistence \
  --json-schema "$SCHEMA" \
  < "$USER_FILE"
