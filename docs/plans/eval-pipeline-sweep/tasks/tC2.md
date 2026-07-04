# tC2: unit tests for pipeline/cli-runner.mjs

**Type:** build (non-documentation; gate = `npm test`)

**Problem:** `evaluation/pipeline/cli-runner.mjs` — the pluggable-CLI shell-out
with retry accounting — has no direct unit tests. Its retry classification
(`ok` / `cli_fail` / `parse_fail`), its `extract_path` dotted-walk with a
non-string guard, and its timeout/exit handling are load-bearing (they drive
the envelope's attempt records and the whole run's model-call contract) yet
entirely uncovered.

**Inputs:** none. Independent of Phases A/B/D and of the other C cards.

**Outcomes** (maps to plan Outcome 4):
- New Vitest unit tests in `tests/api/unit/` cover `runCliWithRetries`
  (exported) attempt accounting: an `ok` first attempt; a `cli_fail`
  (non-zero exit / timeout) that retries; a `parse_fail` (stdout not JSON /
  `extract_path` miss) that retries; and the recorded per-attempt outcomes
  match the classification in the code (~lines 224/243/259).
- Tests cover the `extract_path` dotted-walk (`config.extract_path.split(".")`)
  including a missing-path error and the non-string-value guard. This logic
  lives inside `runCli` — drive it through the exported `runCli` /
  `runCliWithRetries` public API using a mock CLI (do not add exports unless a
  helper genuinely needs one; if so, note it in the PR).
- Tests use a mock CLI stub in the style of
  `tests/api/unit/trace-mock-judge.mjs` (a small `.mjs` that prints a JSON
  envelope on stdout and honors a mode env to simulate ok/cli_fail/parse_fail/
  crash) rather than invoking a real CLI, so the tests need neither a network
  nor an LLM and run in the standard unit gate.
- Tests follow the existing Vitest pattern.
- `npm run test:unit` passes; the full `npm test` gate passes.

**Output artifact:** a new test file under `tests/api/unit/` (e.g.
`tests/api/unit/eval-cli-runner.test.ts`) plus a small mock-CLI stub `.mjs`
fixture if a new one is needed (reuse/extend `trace-mock-judge.mjs` if it fits).

**Out of scope:** envelope (tC1), mechanical (tC3), loader/registry (tC4),
runtime harness (tC5). Changing `cli-runner.mjs` behavior. Integration/E2E
tests.
