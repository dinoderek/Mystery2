#!/usr/bin/env bash
# Build a one-shot generator workspace at <target-dir>.
#
# Layout (after success):
#   <target-dir>/
#     CLAUDE.md                       (copied)
#     README.md                       (copied)
#     docs/*.md                       (copied)
#     prompts/generator-prompt.md     (symlink -> repo)
#     schema/blueprint-schema-v2.ts   (symlink -> repo)
#     scripts/validate-blueprint.mjs  (symlink -> repo)
#
# The wrapper then writes <target-dir>/brief.json before invoking claude.
#
# Symlinks ensure prompt + schema + validator stay in lockstep with the repo
# (so a prompt edit is visible to the very next eval run). Copies of CLAUDE.md
# and the curated docs make in-flight workspaces immune to mid-run edits.

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

mkdir -p "$TARGET/prompts" "$TARGET/schema" "$TARGET/scripts"

# Static files from the template
cp "$TEMPLATE_DIR/CLAUDE.md" "$TARGET/CLAUDE.md"
cp "$TEMPLATE_DIR/README.md" "$TARGET/README.md"
cp -R "$TEMPLATE_DIR/docs" "$TARGET/docs"

# Symlinks to authoritative artifacts in the repo.
# Use absolute paths so workspaces under $HOME work without cwd assumptions.
ln -s "$REPO_ROOT/supabase/functions/_shared/blueprints/generator-prompt.md" \
      "$TARGET/prompts/generator-prompt.md"
ln -s "$REPO_ROOT/packages/shared/src/blueprint-schema-v2.ts" \
      "$TARGET/schema/blueprint-schema-v2.ts"
ln -s "$REPO_ROOT/evaluation/generator-harness/scripts/validate-blueprint.mjs" \
      "$TARGET/scripts/validate-blueprint.mjs"

echo "workspace ready: $TARGET"
