# Design: post-generation verification behavior after deprecation

## Question

The OpenRouter blueprint generator (`scripts/generate-blueprint.mjs`) runs a
post-generation verification sub-step: after writing each blueprint it calls the
deprecated single-prompt evaluator over OpenRouter (`BLUEPRINT_EVALUATION_PROMPT`
+ `BlueprintEvaluationOutputSchema`) and writes a sibling `*.verification.json`.
That evaluator (`packages/shared/src/evaluation/{prompt,schema,index}.ts`) is
being deleted. Deletion breaks this call. **What should the verification sub-step
do once the old evaluator is gone** — invoke the new evaluation pipeline, invoke
a pipeline-aligned subset (e.g. mechanical checks only), or drop verification
(and its `*.verification.json` output) entirely?

## Constraints

Carried from the task card:

- The old evaluator's three files and `docs/blueprint-evaluation.md` **will** be
  deleted — not in question. Only the replacement behavior is.
- `generate-blueprint.mjs` is the OpenRouter path (`OPENROUTER_API_KEY`, writes
  to the blueprints dir). `npm eval` is a separate claude-agent path writing to
  `~/mysteryevals`. The decision governs only `generate-blueprint.mjs`'s
  verification sub-step; it must not merge or conflate the two generation entry
  points.
- The new pipeline (`evaluation/pipeline/run.mjs`) never imports an LLM SDK;
  every model call is a subprocess driven by `config/cli.json`. Any "invoke the
  pipeline" option must account for how an OpenRouter script would drive that.
- The quality gate must stay green: `tests/api/unit/blueprint-generator.test.ts`
  mocks the old verification interface and is updated by the downstream build
  task to match this decision.
- Simple and reversible; smallest blast radius wins ties.

Discovered while surveying:

- The new pipeline's first tier is `runMechanicalChecks({ brief,
  blueprintCandidate })` in `evaluation/checks/mechanical.mjs` — a **pure,
  importable, network-free** function (only imports the two Zod schemas and
  `analyzeClueGraph`; no `fetch`, `fs`, or subprocess). It returns the check
  array `brief_schema_valid, blueprint_schema_valid, culprit/location/character/
  red_herring_count_matches_brief, no_orphan_clues, requires_satisfiable`.
- `generate-blueprint.mjs` already runs an in-script deterministic tier,
  `collectDeterministicIssues()` (unreferenced location/character clues), whose
  output is folded into `*.verification.json` alongside the LLM result. That tier
  is a **strict subset** of `runMechanicalChecks`'s `no_orphan_clues` (the
  mechanical check also traverses sub-locations and adds the count/graph checks).

## Options considered

### Option A: Invoke the new pipeline

The verification sub-step shells out to `evaluation/pipeline/run.mjs` (or its
judge backend) to produce the verification record.

- Deepest coverage (mechanical + LLM judges), single evaluator of record.
- Cross-backend coupling: an OpenRouter script would drive the pipeline's
  claude-agent CLI, adding an **authenticated `claude` CLI** hard prerequisite to
  a path that today needs only `OPENROUTER_API_KEY`. Directly conflates the two
  generation entry points the constraints forbid mixing.
- The pipeline generates-then-evaluates and writes its own run tree to
  `~/mysteryevals`; bending it to "verify this already-written blueprint in the
  blueprints dir" is a misfit (its `--blueprint` skip-generate mode still expects
  a spec dir and CLI config). Large blast radius, slow, network-dependent tests.

### Option B: Invoke a pipeline-aligned subset — mechanical checks only

Replace the deleted LLM verifier call with an in-process call to
`runMechanicalChecks({ brief, blueprintCandidate })` and write its result to
`*.verification.json`. No LLM call in the verification sub-step.

- Reuses the pipeline's own always-on first tier, so the OpenRouter path and the
  canonical pipeline agree on the same deterministic verdicts — no second
  implementation to drift.
- Pure function: no new dependency, no network, no `claude` CLI; keeps the path's
  only hard prerequisite as `OPENROUTER_API_KEY`. Tests become deterministic (no
  mocked LLM verifier).
- Strictly stronger than the in-script `collectDeterministicIssues` it also
  supersedes. Small, self-contained blast radius; trivially reversible.
- Loses the LLM judgement tier of the old verifier (brief-alignment, dead-ends,
  fairness, etc.). Deep semantic review moves to `npm eval`, which is where the
  constraints already say evaluator work lives.

### Option C: Drop verification entirely

Delete the verification sub-step and the `*.verification.json` output.

- Smallest code footprint.
- Removes a signal that generation authors currently rely on and that
  `QUICKSTART.md` documents; a net capability regression, not just a migration.
- Deterministic structural checks are cheap, offline, and already implemented in
  the pipeline — dropping them discards value for no saving. Reversibility is
  fine but the lost behavior is user-visible.

## Decision

**Option B — invoke the pipeline-aligned mechanical subset.** The verification
sub-step calls `runMechanicalChecks({ brief, blueprintCandidate })` in-process
and writes its result to the sibling `*.verification.json`; no LLM verifier call
remains in `generate-blueprint.mjs`.

Why it wins: it is the smallest, most reversible change that keeps a real
post-generation signal. It reuses the pipeline's canonical always-on tier (so the
two paths share one deterministic implementation and cannot drift), adds no
dependency, and — being a pure, network-free function — keeps the OpenRouter
path's only hard prerequisite as `OPENROUTER_API_KEY` while making the gate
deterministic. It also supersedes the in-script `collectDeterministicIssues`
tier with a strict superset.

Why the alternatives lose: **A** drags the claude-agent CLI and a whole
generate-then-evaluate run tree into an OpenRouter script — a large blast radius
that conflates the two entry points the constraints keep separate, and adds an
authenticated-`claude` prerequisite. **C** is a user-visible capability
regression (documented `*.verification.json` disappears) that saves nothing,
since the mechanical tier is cheap and already written.

Downstream shape notes (not re-decisions — the build task owns the exact edits):

- The LLM-only concepts (`--verification-model`, `overall_pass`, per-dimension
  `dimensions{}`, the OpenRouter verification request) no longer apply to this
  sub-step. The build task decides the concrete `*.verification.json` shape from
  the mechanical check array and updates `tests/api/unit/
  blueprint-generator.test.ts` and the `QUICKSTART.md` verification narrative to
  match; the record stays a pass/fail structural report rather than an LLM
  judgement.
- Because the mechanical subset makes the LLM verifier redundant here, the
  companion script `scripts/build-blueprint-evaluation-markdown.mjs` (which only
  renders the deprecated prompt/schema) has no remaining consumer — its removal
  stays with the build task per its card.

## Downstream impact

- tD1: card `Inputs` cites this doc; implements Option B in
  `generate-blueprint.mjs` and updates the affected test.
- tB3: card `Inputs` cites this doc; documents the post-migration
  `generate:blueprint` verification behavior (mechanical structural report, no
  LLM verifier, no `--verification-model`).

## Open questions / follow-ups

- Exact `*.verification.json` schema for the mechanical-only record (field names,
  pass/fail rollup, whether to keep the `deterministic_issues` key) — owned by
  the build task; out of scope here.
- Whether a structural-check failure should make `generate:blueprint` exit
  non-zero, or (as today) report in the summary without failing — the build task
  should preserve current exit semantics unless it records a reason to change.
