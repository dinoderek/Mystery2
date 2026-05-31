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
#   EVAL_DIMENSION_ID — which dimension to judge
#                       (solvability | fairness | coherence |
#                        character_grounding | path_payoff)
#   EVAL_RUN_DIR      — this run's output directory (absolute). The judge
#                       workspace is created at
#                       <EVAL_RUN_DIR>/evaluators/<dimension>/, alongside the
#                       result/blueprint/logs and the generator workspace, all
#                       inside the one self-contained run directory.
# Optional env (standalone fallback when invoked WITHOUT the pipeline):
#   EVAL_WORKSPACE_BASE_ID — brief name used in the fallback run dir name.
#
# This wrapper creates a one-shot judge workspace, invokes the claude CLI inside
# it as an agent, and reads the resulting ./verdict.json back out. Nothing is
# ever deleted: a workspace collision branches to a -retry sibling, so prior
# attempts (and their claude.stderr.log diagnostics) are preserved. Sibling
# dimensions are untouched regardless.

set -euo pipefail

USER_MESSAGE_FILE="${2:?missing user message file path}"
: "${EVAL_DIMENSION_ID:?EVAL_DIMENSION_ID env var required}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# The pipeline passes EVAL_RUN_DIR (the run's output directory). When invoked
# directly without the pipeline, fall back to a fresh standalone run dir under
# the default output root so the wrapper is still usable on its own.
if [[ -n "${EVAL_RUN_DIR:-}" ]]; then
  RUN_DIR="$EVAL_RUN_DIR"
else
  RUN_DIR="${MYSTERYEVALS_DIR:-$HOME/mysteryevals}/$(date +%F)/$(date -u +%H-%M-%SZ)/run-${EVAL_WORKSPACE_BASE_ID:-standalone}"
fi
WORKSPACE_PARENT="$RUN_DIR/evaluators"
WORKSPACE="$WORKSPACE_PARENT/${EVAL_DIMENSION_ID}"

mkdir -p "$WORKSPACE_PARENT"
# Never delete: if the dimension workspace already exists (e.g. a judge retry
# within the same run), branch to a sibling so the prior attempt's diagnostics
# survive. Sibling dimensions are untouched regardless.
if [[ -e "$WORKSPACE" ]]; then
  WORKSPACE="${WORKSPACE}-retry-$(openssl rand -hex 3)"
fi
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
