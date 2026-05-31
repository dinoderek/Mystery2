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
#   EVAL_RUN_DIR — this run's output directory (absolute). The generator
#                  workspace is created at <EVAL_RUN_DIR>/generator/, so the
#                  agent workspace lives alongside result.json/blueprint.json/
#                  logs/ inside the one self-contained run directory.
# Optional env (standalone fallback when invoked WITHOUT the pipeline):
#   EVAL_WORKSPACE_BASE_ID — brief name used in the fallback run dir name.
#
# This wrapper creates a one-shot generator workspace, invokes the claude CLI
# inside it as an agent, and reads the resulting ./blueprint.json back out.
# Nothing is ever deleted: a workspace collision branches to a -retry sibling,
# so prior attempts (and their claude.stderr.log diagnostics) are preserved.

set -euo pipefail

USER_MESSAGE_FILE="${2:?missing user message file path}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# The pipeline passes EVAL_RUN_DIR (the run's output directory). When invoked
# directly without the pipeline, fall back to a fresh standalone run dir under
# the default output root so the wrapper is still usable on its own.
if [[ -n "${EVAL_RUN_DIR:-}" ]]; then
  RUN_DIR="$EVAL_RUN_DIR"
else
  RUN_DIR="${MYSTERYEVALS_DIR:-$HOME/mysteryevals}/$(date +%F)/$(date -u +%H-%M-%SZ)/run-${EVAL_WORKSPACE_BASE_ID:-standalone}"
fi
WORKSPACE="$RUN_DIR/generator"

mkdir -p "$RUN_DIR"
# Never delete: if the workspace already exists (e.g. a generate retry within
# the same run), branch to a sibling so the prior attempt's diagnostics survive.
if [[ -e "$WORKSPACE" ]]; then
  WORKSPACE="${WORKSPACE}-retry-$(openssl rand -hex 3)"
fi
"$REPO_ROOT/evaluation/generator-harness/setup-workspace.sh" "$WORKSPACE" >&2

# Write the brief into the workspace, pretty-printed when it is JSON.
node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(process.argv[1], "utf8");
  try {
    fs.writeFileSync(process.argv[2], JSON.stringify(JSON.parse(raw), null, 2) + "\n");
  } catch {
    fs.writeFileSync(process.argv[2], raw);
  }
' "$USER_MESSAGE_FILE" "$WORKSPACE/brief.json"

cd "$WORKSPACE"
# Drop the user message file path mapping (the agent reads brief.json from
# disk). The CLI prompt is the explicit kickoff message — workspace CLAUDE.md
# provides the rest.
claude --print --output-format json \
       --model opus \
       --effort xhigh \
       --permission-mode auto \
       "Begin. Read ./CLAUDE.md and follow the mandatory iteration protocol. Produce ./blueprint.json that passes the validator." \
       >"$WORKSPACE/claude.stdout.json" \
       2>"$WORKSPACE/claude.stderr.log"

if [[ ! -f "$WORKSPACE/blueprint.json" ]]; then
  echo "agent did not produce blueprint.json in $WORKSPACE" >&2
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
' "$WORKSPACE/blueprint.json" "$WORKSPACE/claude.stdout.json"

# Re-emit the agent's final blueprint in the pipeline's expected envelope shape.
# Use node to JSON-escape the blueprint string safely.
node -e '
  const fs = require("fs");
  const bp = fs.readFileSync(process.argv[1], "utf8");
  process.stdout.write(JSON.stringify({ result: bp }));
' "$WORKSPACE/blueprint.json"
