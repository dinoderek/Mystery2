// Mock CLI for the pluggable-CLI runner's unit tests. Stands in for the
// `claude` wrapper: ignores the prompt files and prints (or fails to print) a
// canned stdout envelope so the runner's retry classification, JSON parsing,
// and dotted extract-path walk can be exercised without a network or an LLM.
//
// Usage (spawned by the runner): node eval-cli-runner-mock.mjs <sys> <user>
// Env MOCK_CLI_MODE controls the behavior:
//   ok (default)  — prints {"result":"{\"answer\":42}"} (a JSON string at .result)
//   crash         — writes to stderr and exits non-zero (drives cli_fail)
//   hang          — sleeps far past any reasonable timeout (drives timeout/cli_fail)
//   not_json      — prints a non-JSON blob on stdout (drives parse_fail)
//   missing_path  — prints valid JSON lacking the extract_path key (drives parse_fail)
//   nested_object — prints JSON whose extract_path resolves to an object, not a
//                   string (drives the non-string guard / parse_fail)
//   plain_string  — prints valid JSON with no nesting (for the extract_path-less path)

import { setTimeout } from "node:timers";
import process from "node:process";

const mode = process.env.MOCK_CLI_MODE ?? "ok";

if (mode === "crash") {
  process.stderr.write("mock cli crashed\n");
  process.exit(1);
}

if (mode === "hang") {
  // Never resolve; the runner's timeout is expected to SIGKILL us.
  setTimeout(() => {}, 60_000);
} else if (mode === "not_json") {
  process.stdout.write("this is not json at all");
} else if (mode === "missing_path") {
  process.stdout.write(JSON.stringify({ other: "value" }));
} else if (mode === "nested_object") {
  process.stdout.write(JSON.stringify({ result: { nested: true } }));
} else if (mode === "plain_string") {
  process.stdout.write(JSON.stringify({ answer: 42 }));
} else {
  // ok
  process.stdout.write(JSON.stringify({ result: JSON.stringify({ answer: 42 }) }));
}
