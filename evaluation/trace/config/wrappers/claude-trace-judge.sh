#!/usr/bin/env bash
# Wrapper invoked by the trace-evaluation pipeline for the "judge" step.
#
# Contract with the pipeline:
#   $1 — path to the composed judge system prompt (judge-system.md + the
#        dimension definition + the dimension's output JSON schema)
#   $2 — path to the user message JSON
#        ({ dimension_id, context, blueprint, turns })
#
#   stdout — { "result": "<verdict-json-string>" } so the pipeline's default
#            extract_path "result" selects the verdict, then JSON-parses and
#            validates it against the dimension's Zod schema.
#
# Unlike the blueprint judge wrapper, this is a single-shot call: the composed
# system prompt already carries the dimension contract and the authoritative
# output schema, so no agent workspace is needed. Swap this script (or point
# cli.json at your own) to bind a different LLM CLI.
#
# We run with stream-json so the pipeline can tail the live event stream from
# $STREAM_FILE (the pipeline sets EVAL_STREAM_FILE to a tailable
# logs/<step>.stream.jsonl). Because there is no disk artifact, we recover the
# assistant's final text — the verdict JSON — from the stream's last
# type:"result" event and re-emit it in the { result } envelope.

set -euo pipefail

SYSTEM_PROMPT_FILE="${1:?missing system prompt file path}"
USER_MESSAGE_FILE="${2:?missing user message file path}"

STREAM_FILE="${EVAL_STREAM_FILE:-${TMPDIR:-/tmp}/claude-trace-judge.$$.jsonl}"
mkdir -p "$(dirname "$STREAM_FILE")"

claude --print \
       --output-format stream-json --verbose \
       --model opus \
       --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
       < "$USER_MESSAGE_FILE" \
       > "$STREAM_FILE"

# Recover the verdict from the stream's final result event and re-emit the
# pipeline's { result } envelope (claude's stderr is left to flow to the
# pipeline's per-step stderr log).
node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
  let result = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev && ev.type === "result" && typeof ev.result === "string") result = ev.result;
  }
  if (result === null) {
    process.stderr.write("trace judge: no result event found in stream\n");
    process.exit(4);
  }
  process.stdout.write(JSON.stringify({ result }));
' "$STREAM_FILE"
