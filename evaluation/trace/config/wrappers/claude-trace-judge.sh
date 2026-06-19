#!/usr/bin/env bash
# Wrapper invoked by the trace-evaluation pipeline for the "judge" step.
#
# Contract with the pipeline:
#   $1 — path to the composed judge system prompt (judge-system.md + the
#        dimension definition + the dimension's output JSON schema)
#   $2 — path to the user message JSON
#        ({ dimension_id, context, blueprint, turns })
#
#   stdout — claude's --output-format json envelope, whose ".result" field
#            (the assistant's text) is the verdict JSON. The pipeline's
#            extract_path "result" selects it, then JSON-parses and validates it
#            against the dimension's Zod schema.
#
# Unlike the blueprint judge wrapper, this is a single-shot call: the composed
# system prompt already carries the dimension contract and the authoritative
# output schema, so no agent workspace is needed. Swap this script (or point
# cli.json at your own) to bind a different LLM CLI.

set -euo pipefail

SYSTEM_PROMPT_FILE="${1:?missing system prompt file path}"
USER_MESSAGE_FILE="${2:?missing user message file path}"

claude --print \
       --output-format json \
       --model opus \
       --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
       < "$USER_MESSAGE_FILE"
