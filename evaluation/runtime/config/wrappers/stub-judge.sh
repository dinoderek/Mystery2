#!/usr/bin/env bash
# Deterministic stub "judge model" for offline wiring tests of LLM judges.
#
#   $1 — user message file (JSON.stringify({ reading_age, action, narration, ... }))
#
# stdout — a clean "nothing wrong" verdict: one canned answer whose fields are
# the union of the LLM judges' contracts that a stub can satisfy:
# estimated_reading_age for age_appropriate_turn, and an empty findings array,
# which every gm_* and candidate schema accepts as a pass. A clue-graph case
# judge's schema asks for more, so a case run on this stub ends in an error
# verdict per judge. No network, no model. Setting RUNTIME_JUDGE_STUB_VERDICT to
# a JSON string replaces the answer for every judge (unit tests use it for fail
# and invalid paths).
set -euo pipefail

USER_FILE="${1:?missing user message file}"

node -e '
  const fs = require("fs");
  // Validate the payload parses (proves the harness wrote real JSON), then reply.
  JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const override = process.env.RUNTIME_JUDGE_STUB_VERDICT;
  process.stdout.write(override !== undefined ? override : JSON.stringify({
    estimated_reading_age: 8,
    findings: [],
    verdict: "pass",
    reasoning: "Stub verdict: nothing to report.",
  }));
' "$USER_FILE"
