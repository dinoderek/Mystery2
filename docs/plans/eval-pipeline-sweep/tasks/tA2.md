# tA2: runtime README gaps

**Type:** build (documentation-only)

**Problem:** `evaluation/runtime/README.md` under-documents the runtime harness:
one env var and two scripts' flags are missing, and a couple of default values
are unstated. A reader cannot fully drive the harness from it.

**Inputs:** none. Independent of tA1 and tA3 (touches a different file), so it
runs in parallel with the whole of Phase A.

**Outcomes** (maps to plan Outcome 3, partial — runtime discoverability of the
harness's own knobs):
- `evaluation/runtime/README.md` documents the `RUNTIME_EVAL_MODEL` env var
  (the backend model override — distinct from the already-documented
  `RUNTIME_EVAL_JUDGE_MODEL` which overrides the judge model). Confirm its exact
  role against `evaluation/runtime/lib/env.mjs` and the CLI backend
  (`evaluation/runtime/lib/backends/`) before documenting.
- The README documents the flags of `evaluation/runtime/rejudge.mjs` and
  `evaluation/runtime/cases-from-trace.mjs` (currently `cases-from-trace.mjs`
  is not mentioned in the README at all; both scripts carry usage in their own
  header comments — surface them in the README).
- The README states the `--out` default is `evaluation/runtime/runs/` and the
  `--ai-profile` default is `default` (verified in
  `evaluation/runtime/run.mjs`). Note: `--out` is already partially covered —
  ensure the stated default matches the code and the `--ai-profile` default is
  added.
- Doc-validation gate passes: commands/paths/flags referenced are accurate and
  match the scripts.

**Output artifact:** edits to `evaluation/runtime/README.md` only.

**Out of scope:** Adding npm scripts or `CLAUDE.md`/`QUICKSTART.md` pointers
(tB1). The end-to-end "from a played trace" runbook (tB2). Any edit to other
docs. Any code change.
