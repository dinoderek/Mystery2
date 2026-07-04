# tD1: land the deprecation — delete old evaluator + migrate callers

**Type:** build (non-documentation; gate = `npm test`)

**Problem:** The deprecated single-prompt evaluator at
`packages/shared/src/evaluation/{prompt,schema,index}.ts` and its historical doc
`docs/blueprint-evaluation.md` are scheduled for removal. Deletion is blocked
until the post-generation verification call in `scripts/generate-blueprint.mjs`
is migrated off the old evaluator. This card lands the deletion + migration per
the design decision.

**Inputs:** tDESIGN merged. Binding contract: `designs/tDESIGN.md ## Decision`
(what `generate-blueprint.mjs`'s post-generation verification does after the old
evaluator is removed).

> Updated from tDESIGN: see `designs/tDESIGN.md ## Decision` — implement that
> verification behavior; do not re-decide it. Log any disagreement in the PR's
> `## Deviations from card`.

**Outcomes** (maps to plan Outcome 5):
- `packages/shared/src/evaluation/prompt.ts`, `.../schema.ts`, and the barrel
  `.../index.ts` are deleted (the barrel exists only to re-export those two).
- `docs/blueprint-evaluation.md` is deleted, and `CLAUDE.md`'s evaluation
  reading list (~line 99) no longer references it.
- `scripts/generate-blueprint.mjs` no longer imports from
  `packages/shared/src/evaluation/*`; its post-generation verification behaves
  per `designs/tDESIGN.md ## Decision`.
- **All importers are handled — not just `generate-blueprint.mjs`.** A second
  importer exists: `scripts/build-blueprint-evaluation-markdown.mjs` imports
  `BLUEPRINT_EVALUATION_PROMPT` (line 5) and the `schema.ts` path (lines 7-10);
  it is wired to `npm run build:evaluation-markdown` and has a test
  (`tests/api/unit/blueprint-evaluation-markdown.test.ts`). Since this script
  and its markdown output exist only to render the deprecated evaluator's
  prompt/schema, remove the script, the `build:evaluation-markdown` npm script,
  and its test alongside the deletion — UNLESS `designs/tDESIGN.md` directs
  otherwise, in which case follow the design and record the choice in the PR.
- Affected tests are updated/removed so the gate stays green:
  `tests/api/unit/blueprint-generator.test.ts` (mocks the old verification
  interface — update to match the migrated behavior) and
  `tests/api/unit/blueprint-evaluation-markdown.test.ts` (remove with its
  subject, per above).
- After removal, **no repo module imports the removed evaluator** (grep for
  `shared/src/evaluation`, `evaluation/prompt`, `evaluation/schema` returns
  nothing outside the plan dir) and **no doc references the deleted files**.
- The full quality gate passes (`npm test`). Deletions do not count toward the
  size budget; the added/modified lines (the migration + test updates) stay
  within ~2000.

**Output artifact:** deletion of `packages/shared/src/evaluation/{prompt,schema,
index}.ts` and `docs/blueprint-evaluation.md`; migration edits in
`scripts/generate-blueprint.mjs`; removal of
`scripts/build-blueprint-evaluation-markdown.mjs` + its `package.json` script +
its test (unless the design says otherwise); updated
`tests/api/unit/blueprint-generator.test.ts`; `CLAUDE.md` reading-list edit.

**Out of scope:** Documenting the reconciled generation-path choice for users
(tB3 — runs after this). The verification-behavior decision (tDESIGN). Touching
the new `evaluation/` pipeline code. Non-import doc de-duplication (Phase A).
