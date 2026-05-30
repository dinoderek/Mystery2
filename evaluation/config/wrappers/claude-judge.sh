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
#                            (solvability | fairness | coherence |
#                             character_grounding | path_payoff)
#   EVAL_WORKSPACE_BASE_ID — the brief name; used for the evaluators folder name.
# Optional env:
#   EVAL_RUN_DATE          — YYYY-MM-DD bucket for this run's workspaces.
#                            Defaults to today (date +%F) when invoked directly.
#
# This wrapper creates a one-shot judge workspace under
# ~/mysteryevals/<run-date>/evaluators-<brief>/<dimension>/, invokes the claude
# CLI inside it as an agent, and reads the resulting ./verdict.json back out.
# All dimensions for a brief share the evaluators-<brief> parent; each folder is
# stable, so a retry reuses (and resets) it.

set -euo pipefail

USER_MESSAGE_FILE="${2:?missing user message file path}"
: "${EVAL_DIMENSION_ID:?EVAL_DIMENSION_ID env var required}"
: "${EVAL_WORKSPACE_BASE_ID:?EVAL_WORKSPACE_BASE_ID env var required}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# All evaluators for one brief live under a single evaluators-<brief> folder
# (inside the dated run root), one subfolder per dimension.
EVAL_RUN_DATE="${EVAL_RUN_DATE:-$(date +%F)}"
WORKSPACE_PARENT="$HOME/mysteryevals/${EVAL_RUN_DATE}/evaluators-${EVAL_WORKSPACE_BASE_ID}"
WORKSPACE="$WORKSPACE_PARENT/${EVAL_DIMENSION_ID}"

mkdir -p "$WORKSPACE_PARENT"
# Stable name per dimension; clear any prior attempt first (per-attempt logs are
# still captured under evaluation/runs/). Sibling dimensions are untouched.
rm -rf "$WORKSPACE"
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
       --model opus \
       --effort xhigh \
       --permission-mode auto \
       "Begin. Read ./CLAUDE.md and follow the mandatory iteration protocol. Produce ./verdict.json that passes the validator." \
       >"$WORKSPACE/claude.stdout.json" \
       2>"$WORKSPACE/claude.stderr.log"

if [[ ! -f "$WORKSPACE/verdict.json" ]]; then
  echo "agent did not produce verdict.json in $WORKSPACE" >&2
  exit 3
fi

# Pretty-print the agent's JSON artifacts in place so the workspace is readable.
node -e '
  const fs = require("fs");
  for (const f of process.argv.slice(1)) {
    try {
      fs.writeFileSync(f, JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8")), null, 2) + "\n");
    } catch {}
  }
' "$WORKSPACE/verdict.json" "$WORKSPACE/claude.stdout.json"

# Re-emit the agent's final verdict in the pipeline's expected envelope shape.
node -e '
  const fs = require("fs");
  const v = fs.readFileSync(process.argv[1], "utf8");
  process.stdout.write(JSON.stringify({ result: v }));
' "$WORKSPACE/verdict.json"
