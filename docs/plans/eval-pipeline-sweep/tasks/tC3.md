# tC3: unit tests for checks/mechanical.mjs

**Type:** build (non-documentation; gate = `npm test`)

**Problem:** `evaluation/checks/mechanical.mjs` — the always-on structural check
tier — has no unit tests of its own. Only its `analyzeClueGraph` dependency
(`evaluation/checks/lib/clue-graph.mjs`) is tested, by
`tests/api/unit/clue-graph-analyzer.test.ts`. The orphan-clue detection
(including sub-location traversal) and the four count-vs-brief checks are the
first line of defense against broken blueprints and are uncovered.

**Inputs:** none. Independent of Phases A/B/D and of the other C cards.

**Outcomes** (maps to plan Outcome 4):
- New Vitest unit tests in `tests/api/unit/` cover `findOrphanClues`
  (`evaluation/checks/mechanical.mjs`) including its sub-location traversal —
  a clue nested under a sub-location must be reachable/counted, and a genuinely
  orphaned clue must be flagged. **Note:** `findOrphanClues` is currently a
  private (non-exported) helper — add a named `export` so it is unit-testable
  (a minimal, behavior-preserving export addition). Alternatively the four count
  checks below can be driven through the exported `runMechanicalChecks` — the
  builder chooses, but `findOrphanClues`'s sub-location behavior should be
  asserted directly.
- Tests cover the four count-vs-brief checks —
  `culprit_count_matches_brief`, `location_count_matches_brief`,
  `character_count_matches_brief`, `red_herring_count_matches_brief` — for both
  match (pass) and mismatch (fail), driven via the exported
  `runMechanicalChecks({ brief, blueprintCandidate })`.
- Tests use small hand-built brief/blueprint fixtures (or the repo's blueprint
  fixture factories where they fit); they need no database or LLM and run in the
  standard unit gate.
- Tests follow the existing Vitest pattern.
- `npm run test:unit` passes; the full `npm test` gate passes.

**Output artifact:** a new test file under `tests/api/unit/` (e.g.
`tests/api/unit/eval-mechanical.test.ts`); an `export` added to
`findOrphanClues` in `evaluation/checks/mechanical.mjs` if the direct-assertion
approach is taken.

**Out of scope:** re-testing `analyzeClueGraph` (already covered by
`clue-graph-analyzer.test.ts`). envelope (tC1), cli-runner (tC2),
loader/registry (tC4), runtime harness (tC5). Changing check behavior.
Integration/E2E tests.
