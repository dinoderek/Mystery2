# tC5: unit tests for the runtime harness core

**Type:** build (non-documentation; gate = `npm test`)

**Problem:** The runtime harness's case-generation logic
(`evaluation/runtime/cases-from-trace.mjs`) and its role/state logic
(`evaluation/runtime/lib/roles.mjs`) are untested. The case-generation helpers
are all private (CLI-only), and the roles logic (action registry, history
normalization, state snapshotting) — which decides what input every runtime
case feeds the model — has no coverage. Bugs here silently produce malformed
cases or wrong prior state.

**Inputs:** none. Independent of Phases A/B/D and of the other C cards.

**Outcomes** (maps to plan Outcome 4):
- New Vitest unit tests in `tests/api/unit/` cover the case-generation helpers
  in `evaluation/runtime/cases-from-trace.mjs`: `sampleEvenly` (even spacing +
  dedup), `actionForEvent`, `buildCase`, and `historyPayload`. **Note:** these
  four helpers are currently private (the file is a CLI script) — add named
  `export`s so they are unit-testable (minimal, behavior-preserving; keep the
  CLI entrypoint working).
- New tests cover the runtime role logic in `evaluation/runtime/lib/roles.mjs`
  (all already exported): `snapshotFromGiven`, `normalizeHistory`, `getAction`,
  and the `ACTIONS` registry (each action type resolves and reports the state
  it is valid from).
- Tests use small fixtures for events/history/given-state; they need no database
  or LLM and run in the standard unit gate. Follow the existing Vitest pattern
  (see `tests/api/unit/runtime-flesch.test.ts` for the runtime-harness testing
  style).
- `npm run test:unit` passes; the full `npm test` gate passes.

**Output artifact:** one or two new test files under `tests/api/unit/` (e.g.
`tests/api/unit/runtime-cases-from-trace.test.ts` and
`tests/api/unit/runtime-roles.test.ts`); named `export`s added to
`sampleEvenly`, `actionForEvent`, `buildCase`, `historyPayload` in
`evaluation/runtime/cases-from-trace.mjs`.

**Out of scope:** envelope (tC1), cli-runner (tC2), mechanical (tC3),
loader/registry (tC4). The npm scripts wrapping these files (tB1). Changing
harness behavior beyond adding exports. Integration/E2E tests.
