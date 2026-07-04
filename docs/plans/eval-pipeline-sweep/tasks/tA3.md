# tA3: de-duplicate docs + fix progressive-disclosure leaks

**Type:** build (documentation-only)

**Problem:** `docs/evaluation-pipeline.md` (the design doc — the "why") and the
READMEs (`evaluation/README.md`, `evaluation/trace/README.md` — the "how")
carry near-verbatim duplicated content that will drift: a "Live progress"
section, a timing-semantics paragraph, and the dimensions table appear in more
than one place. Separately, the design doc leaks low-level operational detail
that belongs only in the READMEs (progressive-disclosure leak): heartbeat flag
`EVAL_HEARTBEAT_MS`, the output-dir override syntax (`--output-root` /
`$MYSTERYEVALS_DIR`), and the min-clue fallback. The design doc should keep the
*why* plus a pointer; the READMEs own the *how*.

**Inputs:** tA1 merged (tA1 corrects the accuracy of the blueprint + trace
READMEs; tA3 then de-duplicates against corrected content and must not
re-introduce the fixed wording).

> This card depends on tA1 only to avoid editing the same README sections
> concurrently and to de-duplicate correct content. tA3 owns
> `docs/evaluation-pipeline.md` exclusively.

**Outcomes** (maps to plan Outcome 1):
- The "Live progress" content lives canonically in the READMEs
  (`evaluation/README.md` → "Live progress"); `docs/evaluation-pipeline.md`
  keeps a short *why* plus a pointer, not the duplicated procedural detail.
- The timing-semantics paragraph (parallel-dimensions wall-clock,
  retries-included stage duration) is stated once as the canonical "how" in
  `evaluation/README.md`; the design doc references it rather than restating it.
- The dimensions table is canonical in one location; the other doc points to it
  instead of copying it.
- The design doc no longer carries the operational knobs that belong in the
  READMEs: `EVAL_HEARTBEAT_MS`, the `--output-root` / `$MYSTERYEVALS_DIR`
  override syntax, and the min-clue fallback specifics — these live in the
  READMEs; the design doc references them.
- While in `docs/evaluation-pipeline.md`, fix its incorrect retry outcome enum:
  it currently reads `ok | cli_fail | schema_fail`; the verified value is
  `ok | cli_fail | parse_fail` for generation attempts (source:
  `evaluation/pipeline/cli-runner.mjs`). (This is the design-doc counterpart of
  the README fix tA1 made; tA1 explicitly deferred this file to tA3.)
- Cross-document consistency holds: after the edits, each duplicated fact is
  stated once and referenced elsewhere; no dangling pointer.
- Doc-validation gate passes.

**Output artifact:** edits to `docs/evaluation-pipeline.md`,
`evaluation/README.md`, and `evaluation/trace/README.md`.

**Out of scope:** The accuracy fixes owned by tA1 (do not re-edit the specific
lines tA1 corrected except where de-duplication requires touching the same
section — in which case preserve tA1's corrected wording). Runtime README
(tA2). Any code change. Adding new content beyond what de-duplication and the
one deferred accuracy fix require.
