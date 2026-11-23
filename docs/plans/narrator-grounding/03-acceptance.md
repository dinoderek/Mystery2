# N3: blinded acceptance on unseen mysteries

Depends on: N2 complete in the [milestone](milestone.md). Status: pending.
Use N1's manifest and baseline and N2's frozen candidate commits/settings.

## Outcome

Report whether the shared grounding policy and any model change improve
unseen-game narration enough to deploy. A report of an unmet objective is a
valid result; successful implementation is not itself evidence of improvement.

## Decided work

1. Confirm the candidates, story split, samples, rubric, cost/usage cap and
   numerical thresholds still match the frozen experiment. Resolve any missing
   authorisation or binding before model calls, not midway through the batch.
2. Measure model and policy effects separately. For fixed turns, compare the
   original and grounded messages on identical state/history for each named
   model. No intermediate prompt tuning on the held-out material.
3. Run full games for each frozen model/policy combination on the reserved new
   mysteries, with the fixed investigator, both personas and predeclared
   repetitions/order. Use normal isolated servers/databases. Avoid independent
   concurrent builds from one checkout; use the harness's own bounded
   concurrency or separate worktrees.
4. Blind model/policy identities during review. Keep the four narrow game
   judges and perform the human review N1 specifies. Examine disputed findings
   against source facts and prior turns, including output judges passed.
5. Report all samples: semantic errors, invalid outputs, infrastructure/model
   failures, timeouts, replay divergence, quits and unfinished games. Distinguish
   paired replay from free self-play; a diverged script is not a completed game.
6. Select a model/policy only if the frozen criteria are met, including reading
   quality and wrongful withholding. Otherwise report which objective failed.
   Any subsequent prompt tuning retires this holdout and needs fresh stories.

## Required report

Per story, model, policy and behaviour group, show denominators and uncertainty:

- material contradictions and invented case facts;
- premature disclosures, earned information withheld and crucial omissions;
- complete games without major violations, alongside termination and win rates;
- readability and a blinded human assessment of narrative quality;
- latency, cost/usage and errors, including slow or incomplete runs.

Include resolved model versions, request/settings hashes or retained messages,
commit references and raw artifact locations. Preserve the original baseline.
Keep credentials and machine-specific absolute paths out of committed data;
normal private run artifacts remain in the established output root.

Do not treat five samples, a high average, model consensus, a green code gate
or a higher win rate alone as evidence of reliable narration. Gate mechanics,
investigator strategy and story quality can also change outcomes.

## Session-level design decisions

- Apply the frozen selection rule to the observed results; explain tradeoffs
  if no candidate dominates. Do not move thresholds after seeing failures.
- A deployment/default change is included only when supported by the evidence
  and agreed with the operator. User-local AI settings are not rewritten by a
  report. Document model choice in the existing configuration/setup owners.
- A critic call, evidence-map contract, model routing or fine-tuning is outside
  this task; propose a separate bounded experiment if needed.

## Validation and completion

Verify report totals against run artifacts and record actual usage. Any changed
analysis code has meaningful offline tests; all non-documentation edits finish
with the full `npm test` and CI. A documentation-only report runs the doc checks
and states why local code suites were skipped.

Graduate durable decisions into [AI Runtime](../../ai-runtime.md),
[configuration](../../ai-configuration.md), [Quickstart](../../../QUICKSTART.md)
or the [playtest runbook](../../../evaluation/playtest/README.md), as applicable.
The PR states met and unmet objectives. Remove this card, the milestone and
their word-budget rows; earlier completed cards must already be absent.
