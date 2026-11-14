#!/usr/bin/env bash
# One-shot OpenAI CLI wrapper for the runtime eval harness.
#
#   $1 — system prompt file (role "strict JSON API" instruction)
#   $2 — user message file   (JSON.stringify({ prompt, context }))
#
# stdout — the role JSON directly (harness extract_path is null).
#
# Requires the `openai` CLI on PATH and OPENAI_API_KEY in the environment.
# Model is taken from EVAL_MODEL, which the evaluation core sets from the
# binding; the wrapper stops when it is unset.
set -euo pipefail

SYS_FILE="${1:?missing system prompt file}"
USER_FILE="${2:?missing user message file}"
MODEL="${EVAL_MODEL:?EVAL_MODEL is not set: give the binding a model}"

openai api chat.completions.create \
  -m "$MODEL" \
  --response-format json_object \
  -g system "$(cat "$SYS_FILE")" \
  -g user "$(cat "$USER_FILE")" \
  --field-at choices.0.message.content
