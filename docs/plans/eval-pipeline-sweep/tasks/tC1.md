# tC1: unit tests for pipeline/envelope.mjs

**Type:** build (non-documentation; gate = `npm test`)

**Problem:** The blueprint pipeline's result-envelope core is essentially
untested. `combineDimension` (the per-dimension pass/fail/error/skipped
combining logic) is only exercised indirectly through the trace re-export;
`buildEnvelope`'s summary tallies are only touched by `eval-timing.test.ts`,
which asserts timing fields, not the summary math; and `countExtraAttempts` is
a private helper with no coverage. Regressions in this logic silently corrupt
every run's verdict.

**Inputs:** none. Independent of Phases A/B/D and of the other C cards
(different modules).

**Outcomes** (maps to plan Outcome 4):
- New Vitest unit tests in `tests/api/unit/` cover `combineDimension`
  (`evaluation/pipeline/envelope.mjs`, exported) across the full matrix:
  analyzer-only, judge-only, both, neither (→ `skipped`), any non-skipped
  `fail` (→ `fail`), analyzer/judge `error` (→ `error`), otherwise `pass`.
- Tests cover `buildEnvelope` summary tallies (`mechanical: {pass, fail}`,
  `dimensions: {pass, fail, error, skipped}`, and the retry counters).
- Tests cover `countExtraAttempts`. **Note:** `countExtraAttempts` is currently
  a private (non-exported) helper in `envelope.mjs` — add a named `export` to it
  so it is unit-testable (a minimal, behavior-preserving export addition).
- Tests follow the existing pattern (`import { describe, expect, it } from
  "vitest"`, `describe/it/expect`); reuse fixture helpers where they exist
  (e.g. the style in `eval-timing.test.ts` / `trace-envelope.test.ts`).
- `npm run test:unit` passes and the new tests run within it; the full
  `npm test` gate passes.

**Output artifact:** a new test file under `tests/api/unit/` (e.g.
`tests/api/unit/eval-envelope.test.ts`); an `export` added to
`countExtraAttempts` in `evaluation/pipeline/envelope.mjs`.

**Out of scope:** cli-runner (tC2), mechanical (tC3), loader/registry (tC4),
runtime harness (tC5). Any behavioral change to `envelope.mjs` beyond adding the
one export. Integration/E2E tests.
