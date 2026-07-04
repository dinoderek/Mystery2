# status: eval-pipeline-sweep

Orchestrator running log. One entry per iteration. Newest at bottom.

## State model
- Integration branch: `main`
- Plan PR: #107 (merged) — plan scaffold landed.
- Builder/designer concurrency cap: 4. Reviewers: unbounded.

## DAG ready-work reference
- No-dep starters: tDESIGN, tA1, tA2, tB1, tC1, tC2, tC3, tC4, tC5
- tA3 ← tA1
- tB2 ← tB1, tA3
- tD1 ← tDESIGN
- tB3 ← tDESIGN, tD1
- tFINAL ← all

## Task state (pending | open | approved | merged)
- tDESIGN — MERGED (PR #109)
- tA1 — MERGED (PR #110)
- tA2 — MERGED (PR #113)
- tA3 — open (building; ← tA1 done)
- tB1 — MERGED (PR #112)
- tB2 — pending (blocked ← tB1 done + tA3)
- tB3 — pending (blocked ← tDESIGN done + tD1)
- tC1 — MERGED (PR #111)
- tC2 — MERGED (PR #114)
- tC3 — MERGED (PR #117)
- tC4 — MERGED (PR #116)
- tC5 — MERGED (PR #115)
- tD1 — open (building; ← tDESIGN done)
- tFINAL — pending (blocked ← all)

## Iterations

### Iteration 1
- First execute iteration. Plan PR #107 already merged; no task PRs existed.
- Ready starters: tDESIGN, tA1, tA2, tB1, tC1–tC5 (9). Cap 4.
- Dispatched (batch 1): **tDESIGN** (design; unblocks tD1, tB3), **tA1** (unblocks tA3→tB2), **tB1** (unblocks tB2), **tC1** (independent test leaf).
- Deferred to next slots: tA2, tC2–tC5 (all leaves), then tA3/tD1 once their deps merge.
- No prior designs to pass to tDESIGN (it is the first design).

### Iteration 2
- tDESIGN completed → PR #109 opened. Decision: verification step calls the
  pipeline-aligned mechanical subset (`runMechanicalChecks`) in-process, writing
  `*.verification.json`; no LLM verifier in the OpenRouter path. Designer flagged
  two items left to tD1: exact `*.verification.json` field shape for a
  mechanical-only record, and whether a structural-check failure should make
  `generate:blueprint` exit non-zero (recommend preserving today's
  "report, don't fail" semantics).
- Pointer edits to tD1/tB3 Inputs are IN PR #109 (not yet on main) — must verify
  after #109 merges before dispatching tD1.
- Dispatched: reviewer for #109; builder tA2 (fills freed slot).
- In flight: builders tA1, tB1, tC1, tA2 (cap 4); reviewer #109.
- Bookkeeping PR #108 (status.md) still awaiting human merge (self-merge blocked).

### Iteration 3
- tA1 completed → PR #110 (doc-only; both READMEs verified vs source; judge enum
  `ok|cli_fail|schema_fail` correctly left intact). Reviewer dispatched.
- Dispatched builder tC2 (cli-runner tests) into freed slot.
- In flight: builders tB1, tC1, tA2, tC2 (cap 4); reviewers #109, #110.
- Queued leaves: tC3, tC4, tC5. Blocked: tA3 (←tA1 merge), tD1 (←tDESIGN merge),
  tB2 (←tB1+tA3), tB3 (←tDESIGN+tD1), tFINAL (←all).
- PRs awaiting human merge: #108, #109, #110 (pending reviewer approval).

### Iteration 4
- Reviewer APPROVED PR #109 (tDESIGN). Host blocks same-identity formal approve;
  verdict delivered as plain comment, first line `Verdict: APPROVED` (protocol OK).
- **CARRY-FORWARD for tD1:** reviewer found a SECOND importer of the old
  evaluator — `scripts/build-blueprint-evaluation-markdown.mjs` — in addition to
  `scripts/generate-blueprint.mjs`. tD1 must migrate/delete ALL importers, not
  just generate-blueprint.mjs. Pass this in tD1's dispatch prompt.
- tDESIGN state → approved (awaiting human merge of #109). tD1 + tB3 stay blocked
  until #109 merges to main (their pointer Inputs edits ride in #109).
- No builder slot change (reviewer completion). Still in flight: builders
  tB1, tC1, tA2, tC2; reviewer #110.
- **HUMAN ACTION NEEDED:** merge #109 to unblock the tD1→tB3 critical chain.

### Iteration 5
- tC1 → PR #111 (full gate PASS). tB1 → PR #112 (full gate PASS; benign
  deviation: CLAUDE.md is a symlink to AGENTS.md, edit landed in AGENTS.md).
- Reviewer APPROVED tA1 #110.
- Confirmed environment: MYSTERY_CLOUD_SESSION unset + Docker available in
  subagent worktrees → builders run the FULL npm test gate (no waivers). This
  means tD1's full-gate requirement is satisfiable.
- Dispatched reviewers for #111, #112.

### Iteration 6
- tA2 → PR #113 (doc-only, verified vs runtime code). Reviewer dispatched.
- Dispatched final leaf builders tC3, tC4, tC5. ALL leaf work now in flight.
- In flight: builders tC2, tC3, tC4, tC5 (cap 4); reviewers #111, #112, #113.
- APPROVED awaiting human merge: #109 (tDESIGN), #110 (tA1). Bookkeeping #108.
- **PLAN NOW GATED ON HUMAN MERGES.** Nothing else can dispatch until merges land:
  tD1 needs #109; tA3 needs #110; then tB2 (tB1+tA3), tB3 (tDESIGN+tD1),
  tFINAL (all). Merge order suggestion: #109, #110 first (unblock tD1 + tA3),
  then the C-test + doc PRs as they approve.
- CARRY-FORWARD reminders for when deps merge:
  - tD1: migrate/delete BOTH importers of the old evaluator
    (`scripts/generate-blueprint.mjs` AND
    `scripts/build-blueprint-evaluation-markdown.mjs`); implement tDESIGN
    decision (mechanical-subset verification writing `*.verification.json`);
    designer left two sub-decisions to tD1 (verification.json field shape;
    keep "report don't fail" exit semantics — recommended).
  - After #109 merges: verify `designs/tDESIGN.md` + pointer Inputs edits to
    tD1/tB3 are on main before dispatching tD1/tB3.
  - After #110 merges: tA3 operates on the corrected README content.

### Iteration 7 (batched — several completions)
- Reviewers APPROVED: tC1 #111, tB1 #112, tA2 #113, tC2 #114 (each independently
  re-ran tests where applicable).
- Builders completed: tC2 #114, tC4 #116, tC5 #115, tC3 #117.
- PR-number map: tDESIGN #109, tA1 #110, tC1 #111, tB1 #112, tA2 #113, tC2 #114,
  tC5 #115, tC4 #116, tC3 #117. (Bookkeeping #108.)
- Reviewers now in flight: #116 (tC4), #115 (tC5), #117 (tC3).
- SOURCE-CHANGE deviations to watch at audit (all flagged behavior-preserving,
  matching the existing `import.meta.url` main-entry-guard convention used by
  run.mjs/extract.mjs):
  - tC1 #111: `export countExtraAttempts` in pipeline/envelope.mjs.
  - tC2 #114: no source change (functions already exported).
  - tC3 #117: `export findOrphanClues` in checks/mechanical.mjs.
  - tC4 #116: `export knownSchemaNames` + main-entry guard in pipeline/validate.mjs.
  - tC5 #115: 4 helper exports + main-entry guard in runtime/cases-from-trace.mjs.
- ALL non-dependent tasks now dispatched. Remaining pending: tA3 (←tA1), tD1
  (←tDESIGN), tB2 (←tB1+tA3), tB3 (←tDESIGN+tD1), tFINAL (←all). Fully gated on
  human merges; will resume dispatch on merge events.

### Iteration 8
- Reviewers APPROVED the remaining three: tC5 #115, tC3 #117, tC4 #116.
- tC4 #116 reviewer triggered a generic self-approval SECURITY WARNING — FALSE
  POSITIVE: it is a distinct reviewer agent (not the builder), posting a
  `Verdict:` COMMENT (not a formal GitHub approval) is its assigned role, and
  same-identity formal approval is host-blocked anyway. No action needed.
- ALL 13 non-dependent PRs now APPROVED & mergeable: #109 tDESIGN, #110 tA1,
  #111 tC1, #112 tB1, #113 tA2, #114 tC2, #115 tC5, #116 tC4, #117 tC3.
  (+ bookkeeping #108.)
- No agents in flight. Plan fully gated on human merges. Next dispatch triggers:
  on #109 merge → tD1; on #110 merge → tA3; then tB2 (tB1+tA3), tB3 (tDESIGN+tD1),
  finally tFINAL (all) → audit.

### Iteration 9 (all 10 PRs merged by human)
- Human merged ALL: #108 (bookkeeping), #109-#117 (all tasks). Verified on
  origin/main: designs/tDESIGN.md present; tD1.md + tB3.md carry the pointer
  Inputs edits; corrected READMEs present; runtime npm scripts present;
  status.md present.
- Consistency check (single design tDESIGN): decision Option B (mechanical
  subset) is faithfully encoded in tD1's contract (both importers handled;
  build-blueprint-evaluation-markdown.mjs removal confirmed by design notes);
  no downstream card invalidated; tB3 still valid. CLEAN.
- Newly ready: tD1 (←tDESIGN), tA3 (←tA1). Disjoint file sets → dispatched both
  in parallel (2 builders, under cap 4).
  - tD1 given the binding design + the "both importers" reminder explicitly.
  - tA3 told to compose with tA1's already-merged corrected README wording.
- Still blocked: tB2 (←tA3), tB3 (←tD1), tFINAL (←all).
- Prior bookkeeping branch (#108) merged + deleted; new bookkeeping branch this
  iteration is off fresh origin/main.
