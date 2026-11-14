#!/usr/bin/env bash
# Wrapper for the generator-api binding: one OpenRouter call writes a Blueprint
# V2 from a brief.
#
#   $1 — path to the rendered system prompt (not read: the request builds the
#        same prompt from the brief)
#   $2 — path to the user message JSON ({ story_brief, instructions })
#
#   stdout — { "result": "<blueprint JSON>" }, which the binding's extract_path
#            reads.
#
# Env from the evaluation core: EVAL_MODEL, the OpenRouter model id.
# Env from the command: OPENROUTER_API_KEY. Optional: AI_OPENROUTER_TIMEOUT_MS
# (default 120000) and OPENROUTER_URL (another chat-completions endpoint).
# The key is never printed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec node "$REPO_ROOT/evaluation/generate/openrouter-wrapper.ts" "$@"
