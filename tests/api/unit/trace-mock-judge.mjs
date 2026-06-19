// Mock judge CLI for trace-run orchestration tests. Stands in for the `claude`
// wrapper: ignores the prompt files and prints a canned envelope whose
// ".result" is a verdict JSON string, matching extract_path "result".
//
// Usage (via the pipeline's cli-runner): node trace-mock-judge.mjs <sys> <user>
// Env MOCK_JUDGE_MODE controls the canned output:
//   pass (default) — a valid passing verdict
//   fail           — a valid failing verdict with one finding
//   invalid        — a schema-invalid object (to exercise schema_fail retries)
//   crash          — exit non-zero (to exercise cli_fail)

import process from "node:process";

const mode = process.env.MOCK_JUDGE_MODE ?? "pass";

if (mode === "crash") {
  process.stderr.write("mock judge crashed\n");
  process.exit(1);
}

let verdict;
if (mode === "fail") {
  verdict = { findings: [{ sequence: 6, severity: "major", claim: "Invented a locked gate.", why: "No such gate in the blueprint." }], verdict: "fail", reasoning: "One major fabrication." };
} else if (mode === "invalid") {
  verdict = { verdict: "maybe" };
} else {
  verdict = { findings: [], verdict: "pass", reasoning: "All narration grounded." };
}

process.stdout.write(JSON.stringify({ result: JSON.stringify(verdict) }));
