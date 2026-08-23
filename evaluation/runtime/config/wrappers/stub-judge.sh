#!/usr/bin/env bash
# Deterministic stub "judge model" for offline wiring tests of LLM judges.
#
#   $1 — user message file (JSON.stringify({ target_age, action, narration, ... }))
#
# stdout — a clean "nothing wrong" verdict. The fields are the union of the
# LLM judges' contracts: estimated_reading_age for age_appropriate, and an empty
# findings array, which every gm_* adherence schema accepts as a pass. No
# network, no model. Override the emitted verdict by setting
# RUNTIME_JUDGE_STUB_VERDICT to a JSON string (used by unit tests to exercise
# fail/invalid paths).
set -euo pipefail

USER_FILE="${1:?missing user message file}"

node -e '
  const fs = require("fs");
  // Validate the payload parses (proves the harness wrote real JSON), then reply.
  JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const override = process.env.RUNTIME_JUDGE_STUB_VERDICT;
  process.stdout.write(override ?? JSON.stringify({
    estimated_reading_age: 8,
    findings: [],
    verdict: "pass",
    reasoning: "Stub verdict: nothing to report.",
  }));
' "$USER_FILE"
