# tB2: end-to-end "from a played trace" runbook + prerequisites

**Type:** build (documentation-only)

**Problem:** Two of the four user workflows — extract a runtime case from a
played trace (UC3), and eval a runtime case (UC4) — form a chain that is
documented **nowhere as one flow**:
`eval:trace:extract` → `evaluation/runtime/cases-from-trace.mjs` →
`evaluation/runtime/run.mjs`. And critical prerequisites are missing or
scattered: the `claude` CLI is a hard, authenticated prerequisite for the
generate step and every judge/CLI backend but is never stated as such; the
`SERVICE_ROLE_KEY` that `eval:trace:extract` needs is not deploy's
`SUPABASE_SERVICE_ROLE_KEY` (it comes from `npx supabase status`) and requires
a running stack with an existing session, none of which is documented; and the
blueprint pipeline silently downgrades to mechanical-only if `--spec`/brief is
omitted or `cli.json` is missing.

**Inputs:** tB1 merged (the runbook uses the npm scripts tB1 adds —
`eval:runtime`, `eval:cases-from-trace` — and `eval:trace:extract`) AND tA3
merged (tA3 is the last Phase-A card to edit `evaluation/README.md` /
`evaluation/trace/README.md`; depending on it serializes README edits so this
card does not concurrently edit the same files, and builds the runbook on the
de-duplicated, corrected READMEs).

> Updated from tB1: use the npm script names introduced by tB1 in the runbook
> commands rather than raw `node …` invocations.

**Outcomes** (maps to plan Outcome 3):
- A single end-to-end runbook exists (place it where a reader will find it —
  e.g. `evaluation/runtime/README.md` and/or `evaluation/trace/README.md`,
  cross-linked) that wires the full "from a played trace" flow:
  `eval:trace:extract` (produce a trace) →
  `eval:cases-from-trace` (produce a runtime case from that trace) →
  `eval:runtime` (evaluate the case), with the prerequisites for each step
  stated inline or by pointer.
- The `claude` CLI is documented **once** as a hard, authenticated prerequisite
  (name the auth requirement) in `evaluation/README.md`, and referenced from the
  trace and runtime READMEs rather than restated.
- `SERVICE_ROLE_KEY` provenance for `eval:trace:extract` is documented: it comes
  from `npx supabase status` (worktree-safe wrapper per repo conventions), is
  **not** deploy's `SUPABASE_SERVICE_ROLE_KEY`, and requires the stack running
  and a session to exist. Point at `docs/local-infrastructure.md` for the stack
  runbook rather than duplicating it.
- It is documented that `--spec`/brief is required even when `--blueprint` is
  passed and must correspond to the blueprint, and that a missing `cli.json`
  silently downgrades the run to mechanical-only (so the reader knows to copy
  `cli.example.json` first). Verify these behaviors against
  `evaluation/pipeline/run.mjs` / `load.mjs` before documenting.
- Doc-validation gate passes: every command (including the new npm script names)
  and path is accurate, links resolve, cross-document consistency holds.

**Output artifact:** the end-to-end runbook + prerequisite documentation in the
evaluation READMEs (`evaluation/README.md`, `evaluation/trace/README.md`,
`evaluation/runtime/README.md` as appropriate), cross-linked.

**Out of scope:** Adding the npm scripts themselves (tB1). Reconciling the two
blueprint-generation paths (tB3). Runtime README flag/default gaps (tA2). Any
code change.
