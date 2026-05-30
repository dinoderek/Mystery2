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
#   EVAL_WORKSPACE_BASE_ID — the brief name; used for the workspace folder name.
# Optional env:
#   EVAL_RUN_DATE          — YYYY-MM-DD bucket for this run's workspaces.
#                            Defaults to today (date +%F) when invoked directly.
#
# This wrapper creates a one-shot generator workspace under
# ~/mysteryevals/<run-date>/generator-<brief>/, invokes the claude CLI inside
# it as an agent, and reads the resulting ./blueprint.json back out. The folder
# name is stable per brief, so a retry/re-run reuses (and resets) it.

set -euo pipefail

USER_MESSAGE_FILE="${2:?missing user message file path}"
: "${EVAL_WORKSPACE_BASE_ID:?EVAL_WORKSPACE_BASE_ID env var required}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Group all agent workspaces for one eval run under a dated root, and give the
# generator a stable, readable per-brief folder name.
EVAL_RUN_DATE="${EVAL_RUN_DATE:-$(date +%F)}"
WORKSPACE_PARENT="$HOME/mysteryevals/${EVAL_RUN_DATE}"
WORKSPACE="$WORKSPACE_PARENT/generator-${EVAL_WORKSPACE_BASE_ID}"

mkdir -p "$WORKSPACE_PARENT"
# Stable name means a retry or same-day re-run reuses the path; clear any prior
# attempt first (per-attempt logs are still captured under evaluation/runs/).
rm -rf "$WORKSPACE"
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
