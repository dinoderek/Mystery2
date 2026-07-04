# tC4: unit tests for loader resolution + registry integrity

**Type:** build (non-documentation; gate = `npm test`)

**Problem:** The pipeline's "add a dimension by dropping in files" promise rests
on generic dimension-id → schema/analyzer resolution and on the named-`schema`
export enforcement — both untested. And nothing guards the two registries
(`evaluation/dimensions/registry.json`,
`evaluation/trace/dimensions/registry.json`) against an entry that points at a
missing or malformed schema/analyzer; such drift would surface only as a
runtime failure mid-eval. This card covers both loader resolution and a
registry-integrity guard (they are the same "resolve a dimension from disk"
concern).

**Inputs:** none. Independent of Phases A/B/D and of the other C cards.

**Outcomes** (maps to plan Outcome 4):
- New Vitest unit tests in `tests/api/unit/` cover the generic dimension-id →
  schema resolution in `evaluation/pipeline/load.mjs`
  (`loadDimensionDefinition` + `tryLoadAnalyzer`, both exported): id →
  `<id>.schema.ts` filename mapping (underscore/kebab conversion), successful
  schema load, and the enforced error when a schema file does not export a
  named `schema` (the `must export a named 'schema'` guard at ~line 97-98).
- Tests cover the schema-name resolution in `evaluation/pipeline/validate.mjs`
  (`knownSchemaNames`). **Note:** `knownSchemaNames` is currently private —
  add a named `export` so it is unit-testable (minimal, behavior-preserving).
- A **registry-integrity** test asserts that **every** entry in
  `evaluation/dimensions/registry.json` AND
  `evaluation/trace/dimensions/registry.json` resolves to a loadable schema
  (and, where a dimension declares/implies an analyzer, a loadable analyzer).
  This test must fail if a future registry entry references a missing or
  malformed schema/analyzer. (Today: 8 blueprint dimensions + 1 trace
  dimension `gm_fabrication`; `clue_graph` and `age_appropriate` have
  analyzers.)
- Tests need no database or LLM and run in the standard unit gate; they follow
  the existing Vitest pattern.
- `npm run test:unit` passes; the full `npm test` gate passes.

**Output artifact:** one or two new test files under `tests/api/unit/` (e.g.
`tests/api/unit/eval-loader.test.ts` and
`tests/api/unit/eval-registry-integrity.test.ts`); an `export` added to
`knownSchemaNames` in `evaluation/pipeline/validate.mjs`.

**Out of scope:** envelope (tC1), cli-runner (tC2), mechanical (tC3), runtime
harness (tC5). Changing loader/validate behavior beyond adding the one export.
Integration/E2E tests.
