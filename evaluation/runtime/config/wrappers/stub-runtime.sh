#!/usr/bin/env bash
# Deterministic stub "model" for offline wiring tests of the CLI backend.
#
#   $1 — user message file (JSON.stringify({ prompt, context }))
#
# stdout — a fixed, age-appropriate role JSON. No network, no model. Lets you
# verify the prompt-build -> CLI -> parse -> transcript path end to end.
set -euo pipefail

USER_FILE="${1:?missing user message file}"

# Echo a short, simple, in-character line plus the empty clue/understood fields
# the talk_conversation contract expects (talk_start ignores the extras).
node -e '
  const fs = require("fs");
  // Validate the payload parses (proves the harness wrote real JSON), then reply.
  JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(JSON.stringify({
    narration: "I was right here by the window. I did not touch the cookies. I saw the cat run past, though.",
    revealed_clue_ids: [],
    input_understood: true,
  }));
' "$USER_FILE"
