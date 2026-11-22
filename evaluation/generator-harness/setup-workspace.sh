#!/usr/bin/env bash
# Build a one-shot generator workspace at <target-dir> for <format>: `v2` (a
# Blueprint V2, the default) or `clue-graph` (a clue-graph case).
#
# Layout (after success), v2:
#   <target-dir>/
#     CLAUDE.md                       (copied)
#     README.md                       (copied)
#     docs/*.md                       (copied)
#     prompts/generator-prompt.md     (symlink -> repo; the wrapper replaces it
#                                      with the pipeline's rendered prompt)
#     schema/blueprint-schema-v2.ts   (symlink -> repo)
#     scripts/validate-blueprint.ts  (symlink -> repo)
#
# clue-graph:
#   <target-dir>/
#     CLAUDE.md                       (copied from template/clue-graph/)
#     docs/clue-graph.md              (copied from the repo's docs/)
#     prompts/generator-prompt.md     (symlink -> repo, replaced as above)
#     schema/clue-graph-schema.ts     (symlink -> repo)
#     schema/clue-graph-sizes.ts      (symlink -> repo)
#     examples/<case>.json            (symlinks -> the hand-written cases)
#     scripts/validate-case.ts        (symlink -> repo)
#     scripts/print-clue-graph-trails.mjs (symlink -> repo)
#
# The wrapper then writes <target-dir>/brief.json before invoking claude.
#
# Symlinks ensure schema + validator (and the prompt, for a hand run) stay in
# lockstep with the repo (so an edit is visible to the very next eval run). Copies of CLAUDE.md
# and the docs make in-flight workspaces immune to mid-run edits.

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <target-dir> [v2|clue-graph]" >&2
  exit 1
fi

TARGET="$1"
FORMAT="${2:-v2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/template"

if [[ -e "$TARGET" ]]; then
  echo "refusing to overwrite existing workspace: $TARGET" >&2
  exit 2
fi

case "$FORMAT" in
  v2 | clue-graph) ;;
  *)
    echo "unknown format: $FORMAT (v2 or clue-graph)" >&2
    exit 1
    ;;
esac

mkdir -p "$TARGET/prompts" "$TARGET/schema" "$TARGET/scripts"

if [[ "$FORMAT" == "clue-graph" ]]; then
  mkdir -p "$TARGET/docs" "$TARGET/examples"
  cp "$TEMPLATE_DIR/clue-graph/CLAUDE.md" "$TARGET/CLAUDE.md"
  cp "$REPO_ROOT/docs/clue-graph.md" "$TARGET/docs/clue-graph.md"
  ln -s "$REPO_ROOT/packages/blueprint-generator/src/clue-graph-prompt.md" \
        "$TARGET/prompts/generator-prompt.md"
  for name in clue-graph-schema.ts clue-graph-sizes.ts; do
    ln -s "$REPO_ROOT/packages/shared/src/$name" "$TARGET/schema/$name"
  done
  for name in dragon-crown greenhouse-prizewinner; do
    ln -s "$REPO_ROOT/blueprints/clue-graph/$name.json" "$TARGET/examples/$name.json"
  done
  ln -s "$REPO_ROOT/evaluation/generator-harness/scripts/validate-case.ts" \
        "$TARGET/scripts/validate-case.ts"
  ln -s "$REPO_ROOT/scripts/print-clue-graph-trails.mjs" \
        "$TARGET/scripts/print-clue-graph-trails.mjs"
  echo "workspace ready: $TARGET"
  exit 0
fi

# Static files from the template
cp "$TEMPLATE_DIR/CLAUDE.md" "$TARGET/CLAUDE.md"
cp "$TEMPLATE_DIR/README.md" "$TARGET/README.md"
cp -R "$TEMPLATE_DIR/docs" "$TARGET/docs"

# Symlinks to authoritative artifacts in the repo.
# Use absolute paths so workspaces under $HOME work without cwd assumptions.
ln -s "$REPO_ROOT/packages/blueprint-generator/src/generator-prompt.md" \
      "$TARGET/prompts/generator-prompt.md"
ln -s "$REPO_ROOT/packages/shared/src/blueprint-schema-v2.ts" \
      "$TARGET/schema/blueprint-schema-v2.ts"
ln -s "$REPO_ROOT/evaluation/generator-harness/scripts/validate-blueprint.ts" \
      "$TARGET/scripts/validate-blueprint.ts"

echo "workspace ready: $TARGET"
