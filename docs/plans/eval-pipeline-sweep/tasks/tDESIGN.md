# tDESIGN: post-generation verification behavior after deprecation

**Type:** design

**Problem:** The deprecated single-prompt evaluator
(`packages/shared/src/evaluation/{prompt,schema,index}.ts`) is scheduled for
deletion, but `scripts/generate-blueprint.mjs` still calls it for
post-generation verification — it invokes the evaluator over OpenRouter with
`BLUEPRINT_EVALUATION_PROMPT` + `BlueprintEvaluationOutputSchema` and writes a
sibling `*.verification.json` next to each generated blueprint. Deleting the
evaluator breaks that path. Before any builder deletes code or reconciles the
generation-path docs, one decision must be made and recorded canonically:
**what should post-generation verification in `scripts/generate-blueprint.mjs`
do once the old evaluator is gone?** Two reasonable builders could ship
materially different things here (invoke the new pipeline; invoke a
pipeline-aligned subset; drop verification entirely), so this is a design task.

**The question (one question, one decision):** After the deprecated
single-prompt evaluator is removed, what should `scripts/generate-blueprint.mjs`
do for its post-generation verification step — invoke the new evaluation
pipeline, invoke a pipeline-aligned subset (e.g. mechanical checks only), or
drop the verification step (and its `*.verification.json` output) entirely?

**Downstream tasks blocked by this design:** `tD1` (deletes the evaluator and
migrates the verification call), `tB3` (documents which generation path a user
should pick, including whatever verification behavior `generate:blueprint`
retains post-migration).

**Known constraints (already decided, not up for grabs):**
- The old evaluator's three files and `docs/blueprint-evaluation.md` WILL be
  deleted — that is not in question; only the replacement behavior of the
  verification step is.
- `scripts/generate-blueprint.mjs` is the OpenRouter generation path
  (`OPENROUTER_API_KEY`, writes to the blueprints dir); the new `npm eval`
  pipeline is a separate claude-agent path writing to `~/mysteryevals`. The
  decision must not conflate or merge the two generation entry points — it only
  governs `generate-blueprint.mjs`'s verification sub-step.
- The new evaluation pipeline (`evaluation/pipeline/run.mjs`) never imports an
  LLM SDK; every model call is a subprocess via `config/cli.json`. Any option
  that "invokes the new pipeline" must respect that the pipeline expects a spec/
  brief and a pluggable CLI, and account for how a caller inside an OpenRouter
  script would drive it.
- Whatever is decided must keep the quality gate green: `tests/api/unit/
  blueprint-generator.test.ts` currently mocks the old verification interface
  and will be updated by `tD1` to match the decision.
- Keep it simple and reversible — smallest blast radius wins ties.

**Pointers to relevant existing code/docs:**
- `scripts/generate-blueprint.mjs` — `verifyGeneratedBlueprint()` (~line 485),
  `buildVerificationRequestBody()` (~line 450), `buildVerificationOutputPath()`
  (`*.verification.json`, ~line 86), `buildVerificationRecord()` (~line 647);
  imports from `packages/shared/src/evaluation/index.ts` at line 15-18.
- `packages/shared/src/evaluation/{index,prompt,schema}.ts` — the code to be
  deleted.
- `evaluation/pipeline/run.mjs`, `evaluation/checks/mechanical.mjs` — the new
  pipeline and its always-on mechanical tier (a candidate "pipeline-aligned
  subset").
- `docs/evaluation-pipeline.md` → "Relationship to the old evaluator" — states
  the intended direction (delete + migrate to the new pipeline or a
  pipeline-aligned variant) but does not decide the specifics.
- `QUICKSTART.md` → "Blueprint Generation" (documents the `.verification.json`
  output at ~line 130).

**Decision authority:** The designer recommends; the human decides in PR review
if there is disagreement.

**Output artifact:** `designs/tDESIGN.md` — one `## Decision` section choosing
one enumerated option, with ≥ 2 options and rationale (including why the
alternatives lose). Plus pointer-only `Inputs` edits to `tasks/tD1.md` and
`tasks/tB3.md` citing `designs/tDESIGN.md ## Decision`. No build code.

**Out of scope:** Deleting the evaluator or editing scripts/tests/docs (that is
`tD1`/`tB3`). Any decision about the two generation entry points beyond the
verification sub-step. Design of the new pipeline itself.
