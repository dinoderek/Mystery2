#!/usr/bin/env bash
# Wrapper invoked by the evaluation pipeline for the "judge" step.
#
# Contract with the pipeline:
#   $1 — path to the rendered judge system prompt (IGNORED in this wrapper;
#        the agent reads judge-system.md, the dimension definition, and the
#        output schema from disk via workspace symlinks)
#   $2 — path to the user message JSON
#        ({ dimension_id, context, story_brief, blueprint })
#
#   stdout — { "result": "<verdict-json-string>" } so the pipeline's default
#            extract_path ".result" works unchanged.
#
# Required env:
#   EVAL_DIMENSION_ID      — which dimension to judge
#                            (solvability | fairness | coherence | character_grounding)
#   EVAL_WORKSPACE_BASE_ID — semantic prefix (typically the spec slug); the
#                            wrapper appends a per-invocation random suffix so
#                            retried attempts get distinct workspaces.
#
# This wrapper creates a fresh one-shot judge workspace under
# ~/mysteryevals/judge-<dim>-<base>-<rand>/, invokes the claude CLI inside it
# as an agent, and reads the resulting ./verdict.json back out.

set -euo pipefail

USER_MESSAGE_FILE="${2:?missing user message file path}"
: "${EVAL_DIMENSION_ID:?EVAL_DIMENSION_ID env var required}"
: "${EVAL_WORKSPACE_BASE_ID:?EVAL_WORKSPACE_BASE_ID env var required}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORKSPACE_PARENT="$HOME/mysteryevals"
WORKSPACE_SUFFIX="$(openssl rand -hex 3)"
WORKSPACE_ID="judge-${EVAL_DIMENSION_ID}-${EVAL_WORKSPACE_BASE_ID}-${WORKSPACE_SUFFIX}"
WORKSPACE="$WORKSPACE_PARENT/$WORKSPACE_ID"

mkdir -p "$WORKSPACE_PARENT"
"$REPO_ROOT/evaluation/judge-harness/setup-workspace.sh" \
  "$WORKSPACE" "$EVAL_DIMENSION_ID" >&2

# Split the pipeline's user-message JSON into separate workspace files.
node -e '
  const fs = require("fs");
  const um = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const dest = process.argv[2];
  fs.writeFileSync(dest + "/brief.json",     JSON.stringify(um.story_brief ?? {}, null, 2));
  fs.writeFileSync(dest + "/blueprint.json", JSON.stringify(um.blueprint   ?? {}, null, 2));
  fs.writeFileSync(dest + "/context.json",   JSON.stringify(um.context     ?? {}, null, 2));
' "$USER_MESSAGE_FILE" "$WORKSPACE"

cd "$WORKSPACE"
claude --print --output-format json \
       --model claude-opus-4-7 \
       --effort xhigh \
       --permission-mode auto \
       "Begin. Read ./CLAUDE.md and follow the mandatory iteration protocol. Produce ./verdict.json that passes the validator." \
       >"$WORKSPACE/claude.stdout.json" \
       2>"$WORKSPACE/claude.stderr.log"

if [[ ! -f "$WORKSPACE/verdict.json" ]]; then
  echo "agent did not produce verdict.json in $WORKSPACE" >&2
  exit 3
fi

# Re-emit the agent's final verdict in the pipeline's expected envelope shape.
node -e '
  const fs = require("fs");
  const v = fs.readFileSync(process.argv[1], "utf8");
  process.stdout.write(JSON.stringify({ result: v }));
' "$WORKSPACE/verdict.json"
