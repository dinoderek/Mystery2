#!/usr/bin/env bash
# Build a one-shot generator workspace at <target-dir>, in which an agent
# writes a clue-graph case.
#
# Layout (after success):
#   <target-dir>/
#     CLAUDE.md                       (copied from template/clue-graph/)
#     docs/clue-graph.md              (copied from the repo's docs/)
#     prompts/generator-prompt.md     (symlink -> repo; the wrapper replaces it
#                                      with the pipeline's rendered prompt)
#     schema/clue-graph-schema.ts     (symlink -> repo)
#     schema/clue-graph-sizes.ts      (symlink -> repo)
#     examples/<case>.json            (symlinks -> the hand-written cases)
#     scripts/validate-case.ts        (symlink -> repo)
#     scripts/print-clue-graph-trails.mjs (symlink -> repo)
#
# The wrapper then writes <target-dir>/brief.json before invoking claude.
#
# Symlinks ensure schema + validator (and the prompt, for a hand run) stay in
# lockstep with the repo (so an edit is visible to the very next eval run).
# Copies of CLAUDE.md and the docs make in-flight workspaces immune to
# mid-run edits.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <target-dir>" >&2
  exit 1
fi

TARGET="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/template"

if [[ -e "$TARGET" ]]; then
  echo "refusing to overwrite existing workspace: $TARGET" >&2
  exit 2
fi

mkdir -p "$TARGET/prompts" "$TARGET/schema" "$TARGET/scripts" "$TARGET/docs" "$TARGET/examples"
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
