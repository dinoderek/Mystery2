#!/usr/bin/env bash
# Build a one-shot judge workspace at <target-dir> for <dimension-id>, judging
# a subject of <format>: `v2` (a Blueprint V2, the default) or `clue_graph` (a
# clue-graph case, with its own instructions and preamble).
#
# Layout (after success):
#   <target-dir>/
#     CLAUDE.md                          (copied)
#     README.md                          (copied)
#     dimension-id                       (written: contains <dimension-id>)
#     dimension.md                       (symlink -> repo)
#     prompts/judge-system.md            (symlink -> repo)
#     schema/output-schema.ts            (symlink -> repo)
#     scripts/validate-judge-output.ts  (symlink -> repo)
#     docs/                              (only for dims that need it)
#       runtime-consumption.md           (symlink -> generator-harness curated)
#
# The wrapper then writes brief.json / blueprint.json / context.json (for a
# clue-graph case: case.json, player_view.json for the step judge, and
# context.json) before invoking claude. The agent writes verdict.json.

set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <target-dir> <dimension-id> [v2|clue_graph]" >&2
  exit 1
fi

TARGET="$1"
DIM_ID="$2"
FORMAT="${3:-v2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/template"
PREAMBLE="$REPO_ROOT/evaluation/prompts/judge-system.md"
INSTRUCTIONS="$TEMPLATE_DIR/CLAUDE.md"
case "$FORMAT" in
  v2) ;;
  clue_graph)
    PREAMBLE="$REPO_ROOT/evaluation/prompts/clue-graph-judge-system.md"
    INSTRUCTIONS="$TEMPLATE_DIR/clue-graph/CLAUDE.md"
    ;;
  *)
    echo "unknown subject format: $FORMAT (v2 or clue_graph)" >&2
    exit 1
    ;;
esac

# Map dim-id to the on-disk filename for its definition / schema. Dimension
# ids use underscores; their files use kebab-case (e.g. character_grounding ->
# character-grounding), the same files its registry entry names. Derived
# generically so a new dimension needs no edit here — only its <slug>.md +
# <slug>.schema.ts + a registry entry (evaluation/core/registry.ts).
DIM_FILE_SLUG="${DIM_ID//_/-}"
if [[ ! -f "$REPO_ROOT/evaluation/dimensions/${DIM_FILE_SLUG}.md" ]]; then
  echo "unknown dimension id: $DIM_ID (no evaluation/dimensions/${DIM_FILE_SLUG}.md)" >&2
  exit 1
fi

if [[ -e "$TARGET" ]]; then
  echo "refusing to overwrite existing workspace: $TARGET" >&2
  exit 2
fi

mkdir -p "$TARGET/prompts" "$TARGET/schema" "$TARGET/scripts"

# Static files from the template
cp "$INSTRUCTIONS" "$TARGET/CLAUDE.md"
cp "$TEMPLATE_DIR/README.md" "$TARGET/README.md"
printf '%s\n' "$DIM_ID" > "$TARGET/dimension-id"

# Symlinks to authoritative artifacts in the repo
ln -s "$REPO_ROOT/evaluation/dimensions/${DIM_FILE_SLUG}.md" \
      "$TARGET/dimension.md"
ln -s "$PREAMBLE" \
      "$TARGET/prompts/judge-system.md"
ln -s "$REPO_ROOT/evaluation/dimensions/${DIM_FILE_SLUG}.schema.ts" \
      "$TARGET/schema/output-schema.ts"
ln -s "$REPO_ROOT/evaluation/judge-harness/scripts/validate-judge-output.ts" \
      "$TARGET/scripts/validate-judge-output.ts"

# Per-dimension docs: character_grounding, and the broad candidate that asks its questions
if [[ "$DIM_ID" == "character_grounding" || "$DIM_ID" == "blueprint_broad" ]]; then
  mkdir -p "$TARGET/docs"
  ln -s "$REPO_ROOT/evaluation/generator-harness/template/docs/runtime-consumption.md" \
        "$TARGET/docs/runtime-consumption.md"
fi

echo "judge workspace ready: $TARGET ($DIM_ID, $FORMAT)"
