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
#
# The canned text is deliberately CONTENT-FREE: it makes no claim about any
# character, place, object, or event. The stub is blueprint-blind, so any
# concrete claim it invented would be a genuine fabrication against whatever
# blueprint the case uses, and the gm_* adherence judges would (correctly) fail
# every offline run. Same reasoning as writing it at the target reading age for
# the flesch judge: the stub is a fixture, and a fixture should leave a clean
# baseline so a real failure stands out.
#
# It does branch on context.role_name for VOICE, because voice is not content:
# character roles must speak in first person and narrator roles must address the
# player as "you", and a fixture that got that backwards would fail gm_roleplay
# for a reason that says nothing about the runtime. What the stub cannot do is
# be in-character for an unknown character — a cooperative line is wrong for a
# character authored as hostile — so a gm_roleplay finding on a cli:stub run may
# be the fixture's fault. Judge-side wiring checks belong on the judge-stub
# variant instead.
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

  // Character roles speak in first person; every other role is the narrator
  // talking to "you". role_name comes from the context the harness built.
  const roleName = isRoleOutput ? (JSON.parse(raw).context?.role_name ?? "") : "";
  const isCharacterRole = roleName.startsWith("talk");

  process.stdout.write(
    isRoleOutput
      ? JSON.stringify({
          narration: isCharacterRole
            ? "\"Of course,\" comes the friendly reply. \"Ask me whatever you like.\""
            : "You take a slow look around. Nothing new catches your eye just yet.",
          revealed_clue_ids: [],
          input_understood: true,
        })
      : "You take a slow look around. Nothing new catches your eye just yet.",
  );
' "$USER_FILE"
