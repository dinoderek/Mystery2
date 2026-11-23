# N1: trustworthy messages and a frozen baseline

Depends on: this plan merged. Status: captured; awaiting blinded operator review.
Scope and decisions: [milestone](milestone.md).

## Outcome

Live narration and evaluation use the same message construction and role-output
parsers. Capture the original-policy development baseline before changing any
narrator instructions. Fix only measurement defects needed for this experiment.

## Decided work

1. Trace the structured and plain-prose requests end to end. Centralise their
   message construction in the existing pure assembly path; live OpenRouter,
   live Claude CLI and runtime replay consume it. Include intro, arrival,
   search, talk and accusation calls across supported case formats.
2. Preserve current system/user strings byte for byte in this refactor. The
   current instructions stay at their current priority until N2. Do not change
   game rules, narrator contracts or role visibility.
3. Make replay use the requested role's normal parser, never infer the role
   from the answer's shape. Prove malformed output cannot earn a passing grade.
   Distinguish parser failure from a semantically wrong reveal that live play
   refuses; include both in the report, never discard them as successes.
4. Use engine-produced histories and verify the reconstructed inputs used by
   the experiment. Repair any input-loss defect on this path with a focused
   regression test. Do not expand this into the full audit backlog.
5. Freeze the experiment manifest and rubric before live calls. Existing
   examples are development data. Reserve whole fresh mysteries with varied
   structures and ages; do not use their outputs to tune N2.
6. Smoke-test the named models through the existing wrappers, then capture the
   original-policy development baseline. Preserve requests, raw responses,
   versions, settings, commit, usage and latency in normal run artifacts.

The CLI replay currently parses generic JSON before later grading; the live
engine also checks admissibility. Shared parsing alone does not establish full
engine parity. Define which layer each result measures.

## Session-level design decisions

- Smallest shared message shape and migration of plain narration callers.
- Development and held-out story counts, fixed-turn samples, whole-game
  repetitions, fixed investigator/personas and counterbalanced run order.
- Exact model versions, compatible transports and handling of unavailable
  candidates. Inspect wrapper/API compatibility instead of assuming support.
- Cost/usage cap and stop conditions, agreed with the operator before batches.
- Broad rubric and numerical comparison thresholds, frozen before results.
  Proposed acceptance target: no observed major violations on the final set;
  report sample size and uncertainty rather than imply universal reliability.
- Blinded human review of findings, including a sample of judge-passed output.
  A judge's agreement with another judge is not ground truth.
- Where the manifest and original baseline are retained so N3 can reproduce
  them after this card is removed. Keep held-out outputs sealed until N3.

## Validation and completion

- Tests compare captured live/replay messages for every narrator interaction,
  with age, style, history, format and role-specific fields intact.
- Test malformed role output, including an invalid graph-search notebook.
- Tests retain authorised context boundaries and exercise necessary input-loss
  fixes. Mock, snapshots and fixtures follow the shared request shape.
- Full `npm test` and CI pass; review any intentional snapshot changes.
- PR reports the frozen manifest, baseline artifacts and actual live usage.
  No incomplete sample is hidden, and no paid batch exceeds its cap.

Update [runtime evaluation](../../../evaluation/runtime/README.md) and
[runtime](../../ai-runtime.md) where behaviour changes. Remove this card and its
word-budget row; mark N1 complete in the milestone, removing this card's link.
