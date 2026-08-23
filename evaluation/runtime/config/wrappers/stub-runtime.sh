#!/usr/bin/env bash
# Deterministic stub "model" for offline wiring tests of the CLI backend.
#
#   $1 — user message file. Role-output roles write JSON.stringify({prompt,
#        context}); narration roles (intro, ambience) write the raw prompt text,
#        mirroring what the provider actually sends in each case.
#
# stdout — a fixed, age-appropriate reply in the shape that role expects: role
# JSON for role-output roles, plain narration text for narration roles. No
# network, no model. Lets you verify the prompt-build -> CLI -> parse ->
# transcript path end to end.
set -euo pipefail

USER_FILE="${1:?missing user message file}"

node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(process.argv[1], "utf8");

  // A JSON payload means a role-output role; anything else is a narration
  // prompt sent as plain text. Detecting by parse rather than by flag keeps the
  // stub honest about what it was actually handed.
  let isRoleOutput = true;
  try { JSON.parse(raw); } catch { isRoleOutput = false; }

  process.stdout.write(
    isRoleOutput
      ? JSON.stringify({
          narration: "I was right here by the window. I did not touch the cookies. I saw the cat run past, though.",
          revealed_clue_ids: [],
          input_understood: true,
        })
      : "You step into the warm kitchen. A cake tin sits open on the counter, and the lid is on the floor.",
  );
' "$USER_FILE"
