#!/usr/bin/env bash
# Deterministic stub "judge model" for offline wiring tests of LLM judges.
#
#   $1 — user message file (JSON.stringify({ target_age, action, narration, ... }))
#
# stdout — a clean "nothing wrong" verdict. A blueprint dimension of the default
# battery, named by EVAL_DIMENSION_ID, gets its own answer from
# stub-judge-blueprint.json beside this script: a pass citing the ids of the
# test fixture blueprint, so the whole battery passes on it. Every other judge
# gets one canned answer whose fields are the union of the other LLM judges'
# contracts: estimated_reading_age for age_appropriate_turn, and an empty
# findings array, which every gm_* and candidate schema accepts as a pass. No
# network, no model. Setting RUNTIME_JUDGE_STUB_VERDICT to a JSON string
# replaces the answer for every judge (unit tests use it for fail and invalid
# paths).
set -euo pipefail

USER_FILE="${1:?missing user message file}"
ANSWERS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stub-judge-blueprint.json"

node -e '
  const fs = require("fs");
  // Validate the payload parses (proves the harness wrote real JSON), then reply.
  JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const override = process.env.RUNTIME_JUDGE_STUB_VERDICT;
  if (override !== undefined) {
    process.stdout.write(override);
    process.exit(0);
  }
  const answers = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const dimension = process.env.EVAL_DIMENSION_ID;
  const own = dimension && dimension !== "_comment" && Object.hasOwn(answers, dimension) ? answers[dimension] : undefined;
  process.stdout.write(JSON.stringify(own ?? {
    estimated_reading_age: 8,
    findings: [],
    verdict: "pass",
    reasoning: "Stub verdict: nothing to report.",
  }));
' "$USER_FILE" "$ANSWERS"
