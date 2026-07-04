# tFINAL: verify plan outcomes

**Type:** build (final test card — sink of the DAG)

**Problem:** Verify that the plan's five outcomes are delivered end-to-end. This
task is the contract with the human — its tests must fail if an outcome is
missed. Because several outcomes are documentation/discoverability/deletion
outcomes rather than behavioral APIs, this card automates them with
**guard tests** (grep/presence assertions over docs, `package.json`, and the
source tree) and relies on the Phase-C tests for the coverage outcome. It does
**not** duplicate the Phase-C unit tests.

**Inputs:** all other tasks merged (tDESIGN, tA1–tA3, tB1–tB3, tC1–tC5, tD1).
Read the plan's `## Outcomes` section verbatim.

**Outcomes:**
- **Outcome 1 (docs match code) — guard test.** A test asserts, over the
  evaluation docs (`evaluation/README.md`, `evaluation/trace/README.md`,
  `docs/evaluation-pipeline.md`):
  - the phantom mechanical-check tokens `mustInclude` and the cover-up check are
    absent from the mechanical-checks descriptions, and the eight real check ids
    are the documented set;
  - the phrase "None are implemented today" (or equivalent analyzer-absence
    claim) is absent;
  - where the generation-attempt outcome enum is documented, it reads
    `ok | cli_fail | parse_fail` and neither doc still says `schema_fail` for
    the generation attempts nor omits `parse_fail`;
  - the trace bare-search reveal description no longer uses the strict-"prefix"
    wording.
  (This is a regression guard; it does not attempt to fully re-derive semantic
  correctness — that portion is manually verified, see PR notes.)
- **Outcome 2 (discoverability) — automated.** A test asserts `package.json`
  defines `eval:runtime`, `eval:runtime:rejudge`, and `eval:cases-from-trace`
  (alongside the pre-existing `eval`, `eval:trace`, `eval:trace:extract`), and
  that `CLAUDE.md` and `QUICKSTART.md` both reference `evaluation/runtime/`
  (its README) so all three pipelines are surfaced.
- **Outcome 3 (workflows runnable) — partial automation.** A smoke test asserts
  the documented runtime npm scripts resolve to their scripts and that the
  underlying entrypoints parse their arguments without crashing on a
  no-op/`--help`-style invocation (no model call, no DB). Prose-runbook
  completeness (the "from a played trace" chain and the stated prerequisites) is
  verified manually — see PR notes; the automated portion guards that the
  documented commands are real and invocable.
- **Outcome 4 (coverage) — via Phase-C tests.** Assert (do not duplicate) that
  the Phase-C unit test files exist and pass in the gate: reference the test
  files declared by tC1–tC5 (envelope, cli-runner, mechanical, loader +
  registry-integrity, runtime cases-from-trace + roles). The gate running them
  green is the assertion; add at most a light presence check that each declared
  test file exists.
- **Outcome 5 (deletion) — automated.** A test asserts that
  `packages/shared/src/evaluation/{prompt,schema,index}.ts` and
  `docs/blueprint-evaluation.md` do not exist; that no repo module (outside the
  plan dir) imports `shared/src/evaluation`, `evaluation/prompt`, or
  `evaluation/schema`; and that `scripts/generate-blueprint.mjs` contains no
  import of the removed evaluator.
- All tests run in `npm run test:unit` / the `npm test` gate and fail if any
  outcome regresses.

**Output artifact:** new test file(s) under `tests/api/unit/` — e.g.
`tests/api/unit/eval-pipeline-sweep-outcomes.test.ts` (guard/discoverability/
deletion assertions) and, if separated, a small doc-accuracy guard file. List
each so the audit can grep for it.

**Out of scope:** Re-implementing the Phase-C unit tests (they belong on
tC1–tC5). Testing behavior beyond the plan outcomes. Any code change to the
pipelines. Integration/E2E tests.
