#!/usr/bin/env bash
# Build a one-shot judge workspace at <target-dir> for <dimension-id>.
#
# Layout (after success):
#   <target-dir>/
#     CLAUDE.md                          (copied)
#     README.md                          (copied)
#     dimension-id                       (written: contains <dimension-id>)
#     dimension.md                       (symlink -> repo)
#     prompts/judge-system.md            (symlink -> repo)
#     schema/output-schema.ts            (symlink -> repo)
#     scripts/validate-judge-output.mjs  (symlink -> repo)
#     docs/                              (only for dims that need it)
#       runtime-consumption.md           (symlink -> generator-harness curated)
#
# The wrapper then writes brief.json / blueprint.json / context.json before
# invoking claude. The agent writes verdict.json.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <target-dir> <dimension-id>" >&2
  exit 1
fi

TARGET="$1"
DIM_ID="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/template"

# Map dim-id to the on-disk filename for its definition / schema. Dimension
# ids use underscores; their files use kebab-case (e.g. character_grounding ->
# character-grounding), matching dimensionIdToFilename() in
# evaluation/pipeline/load.mjs. Derived generically so a new dimension needs no
# edit here — only its <slug>.md + <slug>.schema.ts + a registry entry.
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
cp "$TEMPLATE_DIR/CLAUDE.md" "$TARGET/CLAUDE.md"
cp "$TEMPLATE_DIR/README.md" "$TARGET/README.md"
printf '%s\n' "$DIM_ID" > "$TARGET/dimension-id"

# Symlinks to authoritative artifacts in the repo
ln -s "$REPO_ROOT/evaluation/dimensions/${DIM_FILE_SLUG}.md" \
      "$TARGET/dimension.md"
ln -s "$REPO_ROOT/evaluation/prompts/judge-system.md" \
      "$TARGET/prompts/judge-system.md"
ln -s "$REPO_ROOT/evaluation/dimensions/${DIM_FILE_SLUG}.schema.ts" \
      "$TARGET/schema/output-schema.ts"
ln -s "$REPO_ROOT/evaluation/judge-harness/scripts/validate-judge-output.mjs" \
      "$TARGET/scripts/validate-judge-output.mjs"

# Per-dimension docs (only character_grounding needs extra context today)
if [[ "$DIM_ID" == "character_grounding" ]]; then
  mkdir -p "$TARGET/docs"
  ln -s "$REPO_ROOT/evaluation/generator-harness/template/docs/runtime-consumption.md" \
        "$TARGET/docs/runtime-consumption.md"
fi

echo "judge workspace ready: $TARGET ($DIM_ID)"
