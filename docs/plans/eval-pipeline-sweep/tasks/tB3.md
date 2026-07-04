# tB3: reconcile the two blueprint-generation paths

**Type:** build (documentation-only)

**Problem:** There are two ways to generate a blueprint and the docs do not help
a user pick correctly:
- npm `generate:blueprint` (`scripts/generate-blueprint.mjs`) — OpenRouter path,
  needs `OPENROUTER_API_KEY`, writes to the blueprints dir, and historically ran
  the DEPRECATED single-prompt verifier for its `*.verification.json` output.
- npm `eval` (`evaluation/pipeline/run.mjs`) — the claude-agent wrapper path on
  the current pipeline, writes to `~/mysteryevals`.
These are documented in separate places (`QUICKSTART.md` → "Blueprint
Generation" for the former; `evaluation/README.md` for the latter) with no
guidance on when to use which. This card lands the reconciliation. Because the
verifier behavior of `generate:blueprint` changes when the deprecation lands,
this card documents the **post-migration** state — so it depends on both the
verification-behavior decision and the migration itself.

**Inputs:** tDESIGN merged (binding decision on post-deprecation verification
behavior) AND tD1 merged (the migration is applied, so the documented behavior
matches reality). Binding contract: `designs/tDESIGN.md ## Decision` — document
the behavior it decides; do not restate or re-derive it here.

> Updated from tDESIGN: see `designs/tDESIGN.md ## Decision` for what
> `generate:blueprint`'s post-generation verification does after the old
> evaluator is removed — document that behavior, do not re-decide it.

**Outcomes** (maps to plan Outcome 3):
- The docs give a clear "pick the right path" comparison of `generate:blueprint`
  (OpenRouter, `OPENROUTER_API_KEY`, blueprints dir, post-migration verification
  behavior per `designs/tDESIGN.md ## Decision`) vs `eval` (claude-agent
  wrapper, current pipeline, `~/mysteryevals`), in one canonical place and
  cross-referenced from the other.
- `QUICKSTART.md` → "Blueprint Generation" reflects the post-deprecation reality
  of `generate:blueprint` — in particular the `*.verification.json` narrative
  (~line 130) matches whatever `tD1` shipped (no reference to the removed
  evaluator; no stale `--verification-model` guidance if that flag was removed
  by the decision).
- No doc references the deleted `docs/blueprint-evaluation.md` or the removed
  `packages/shared/src/evaluation/*` after this card.
- Doc-validation gate passes: commands, flags, and paths are accurate against the
  post-`tD1` code; cross-document consistency holds.

**Output artifact:** edits to `QUICKSTART.md` and `evaluation/README.md` (and any
other doc that describes generation-path choice) reconciling the two paths.

**Out of scope:** Deleting the evaluator or editing scripts/tests (tD1). The
verification-behavior decision itself (tDESIGN). The runtime "from a trace"
runbook (tB2). Any code change.
