#!/usr/bin/env bash
# Wrapper invoked by the evaluation pipeline for the "generate" step.
#
# Contract with the pipeline:
#   $1 — path to the rendered generator system prompt (IGNORED in this wrapper;
#        the agent reads the canonical prompt from disk via the workspace
#        symlink, so the pipeline's rendered copy is not used)
#   $2 — path to the user message JSON ({ story_brief, instructions })
#
#   stdout — must be a single JSON object whose extract_path resolves to a
#            valid Blueprint V2 JSON string. We emit { "result": "<bp>" } so
#            the pipeline's default extract_path ".result" works unchanged.
#
# Required env:
#   EVAL_WORKSPACE_BASE_ID — semantic prefix for the workspace dir name. The
#                            wrapper appends a per-invocation random suffix so
#                            retried attempts get distinct workspaces.
#
# This wrapper creates a fresh one-shot generator workspace under
# ~/mysteryevals/<base>-<rand>/, invokes the claude CLI inside it as an
# agent, and reads the resulting ./blueprint.json back out.

set -euo pipefail

USER_MESSAGE_FILE="${2:?missing user message file path}"
: "${EVAL_WORKSPACE_BASE_ID:?EVAL_WORKSPACE_BASE_ID env var required}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORKSPACE_PARENT="$HOME/mysteryevals"
# 6-hex random suffix → 16M-space, negligible collision risk under reasonable
# usage. openssl is in macOS base and most Linux distros.
WORKSPACE_SUFFIX="$(openssl rand -hex 3)"
WORKSPACE_ID="${EVAL_WORKSPACE_BASE_ID}-${WORKSPACE_SUFFIX}"
WORKSPACE="$WORKSPACE_PARENT/$WORKSPACE_ID"

mkdir -p "$WORKSPACE_PARENT"
"$REPO_ROOT/evaluation/generator-harness/setup-workspace.sh" "$WORKSPACE" >&2
cp "$USER_MESSAGE_FILE" "$WORKSPACE/brief.json"

cd "$WORKSPACE"
# Drop the user message file path mapping (the agent reads brief.json from
# disk). The CLI prompt is the explicit kickoff message — workspace CLAUDE.md
# provides the rest.
claude --print --output-format json \
       --model claude-opus-4-7 \
       --effort xhigh \
       --permission-mode auto \
       "Begin. Read ./CLAUDE.md and follow the mandatory iteration protocol. Produce ./blueprint.json that passes the validator." \
       >"$WORKSPACE/claude.stdout.json" \
       2>"$WORKSPACE/claude.stderr.log"

if [[ ! -f "$WORKSPACE/blueprint.json" ]]; then
  echo "agent did not produce blueprint.json in $WORKSPACE" >&2
  exit 3
fi

# Re-emit the agent's final blueprint in the pipeline's expected envelope shape.
# Use node to JSON-escape the blueprint string safely.
node -e '
  const fs = require("fs");
  const bp = fs.readFileSync(process.argv[1], "utf8");
  process.stdout.write(JSON.stringify({ result: bp }));
' "$WORKSPACE/blueprint.json"
