#!/usr/bin/env bash
# One-shot Claude CLI wrapper for the runtime eval harness.
#
#   $1 — system prompt file (role "strict JSON API" instruction)
#   $2 — user message file   (JSON.stringify({ prompt, context }))
#
# stdout — the Claude Code JSON envelope. The harness extract_path is "result",
#          so the model's reply (which must be the role JSON) is read from there.
#
# Model is taken from EVAL_MODEL (set by the evaluation core's model runner from
# the binding); the wrapper stops when it is unset.
#
# `--system-prompt` replaces Claude Code's own system prompt instead of appending
# to it, and the remaining flags keep out its tools, MCP servers and settings,
# which include this repo's CLAUDE.md. The CLI still adds a short environment
# note (date, working directory, model). Because user settings are skipped too,
# a login configured only in settings.json (apiKeyHelper, Bedrock or Vertex env)
# is not picked up. The trace judge wrapper
# (evaluation/trace/config/wrappers/claude-trace-judge.sh) uses the same flags.
#
# With EVAL_JSON_SCHEMA_FILE set (a judge whose answer has a schema), the CLI
# holds its answer to that schema (`--json-schema`), and its checked
# `structured_output` becomes `result`: free text can end malformed, such as a
# string left unclosed. Without it, as for the narrator, the reply is as written.
set -euo pipefail

SYS_FILE="${1:?missing system prompt file}"
USER_FILE="${2:?missing user message file}"
MODEL="${EVAL_MODEL:?EVAL_MODEL is not set: give the binding a model}"

ARGS=(
  --print
  --output-format json
  --model "$MODEL"
  --system-prompt "$(cat "$SYS_FILE")"
  --tools ""
  --strict-mcp-config
  --setting-sources ""
  --no-session-persistence
)

if [[ -z "${EVAL_JSON_SCHEMA_FILE:-}" ]]; then
  exec claude "${ARGS[@]}" < "$USER_FILE"
fi

[[ -r "$EVAL_JSON_SCHEMA_FILE" ]] || { echo "claude-runtime.sh: no schema at $EVAL_JSON_SCHEMA_FILE" >&2; exit 2; }
SCHEMA="$(cat "$EVAL_JSON_SCHEMA_FILE")"

claude "${ARGS[@]}" --json-schema "$SCHEMA" < "$USER_FILE" | node -e '
let text = "";
process.stdin.setEncoding("utf8"); // a character split across two reads stays whole
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    process.stdout.write(text); // not an envelope: the runner reports it as it is
    return;
  }
  if (envelope && typeof envelope === "object" && envelope.structured_output !== undefined) {
    envelope.result = JSON.stringify(envelope.structured_output);
  }
  process.stdout.write(JSON.stringify(envelope));
});
'
