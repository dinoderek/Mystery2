# Narrator grounding on unseen mysteries

Status: measurement in progress. Checked against main `7eee941` on 2026-11-23.

## Objective

Improve the narrator's adherence to supplied facts and reveal conditions on
unseen mysteries, while preserving readable, lively play. Measure model choice
separately from the grounding-policy change. Success on familiar examples is
development evidence, not proof of transfer.

The acceptance reports in [PR 324](https://github.com/dinoderek/Mystery2/pull/324)
and [PR 330](https://github.com/dinoderek/Mystery2/pull/330) record inventions,
premature disclosures and omissions despite strong isolated scores.

## Decisions

- Preserve the blueprint/narrator split, model judgement, CLI wrappers, replay,
  self-play and existing game mechanics. No character-specific prompt patches
  or production keyword rules.
- Preserve existing model calls and output contracts, including the two-stage
  clue-graph accusation. Additional verification calls, source-map fields,
  fine-tuning and model routing require a later measured experiment.
- Copy a concise adaptation of Anthropic's grounding guidance into one shared
  runtime policy. Reference the source and review date in the owning runtime
  doc; a URL alone does not instruct a tool-free narrator.
- Stable policy belongs in the high-priority message. Player words, history
  and case material remain separated as data. Never promote interpolated player
  text into higher-priority instructions or widen a role's private context.
- Active authored lies remain playable; credible bluffs and deductions keep
  their existing effect. Grounding does not make every supplied fact revealable.
- Judge development and held-out outputs against the same frozen rubric.
  Include wrongful withholding, not just invention and early disclosure.

## Sequence

| Task | Depends on | Deliverable | Status |
|---|---|---|---|
| [N1: measurement](01-measurement.md) | Plan merged | Equivalent messages and validation, frozen experiment, original-policy baseline | In progress; revised USD8 diagnostic capture |
| [N2: policy](02-policy.md) | N1 complete | Shared high-priority grounding policy, with sources | Pending |
| [N3: acceptance](03-acceptance.md) | N2 complete | Blinded unseen-game comparison and deployment recommendation | Pending |

One task, session, worktree and PR at a time. Execution follows the
task-protocol skill and the repository's [workflow](../../../AGENTS.md).
Each implementation PR runs the full gate and CI and receives a fresh review.
Remove its completed card and word-budget row; replace its table link with
plain completed text. The last task also removes this milestone and its row.
Durable decisions belong in the owning docs, never in references to these cards.

## Measurement decisions before live calls

N1 resolves and records exact model versions and available bindings, story
selection, sample counts, run order, rubric, human review, acceptance thresholds
and the operator's cost or subscription-usage limit. No paid batch starts with
those decisions unresolved. Hold out whole new mysteries before policy tuning;
their transcripts and scores are not inspected until N3 freezes its candidates.
If the held-out set informs another prompt edit, retire it as development data
and obtain a fresh holdout.

Candidate models are the current resolved Sonnet, Claude Opus 5.5 and GPT-6.2
Astra, subject to availability. An unavailable candidate is reported rather
than silently replaced. Record actual models, settings, commit and messages.

## Sources and owners

Anthropic guidance, reviewed 2026-11-23:
[grounding](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
and [prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices).
Apply uncertainty, source excerpts, claim verification, source limits and draft
review. Repeated samples measure instability; consensus is not proof of truth.

Owners: [runtime](../../ai-runtime.md), [configuration](../../ai-configuration.md),
[runtime evaluation](../../../evaluation/runtime/README.md),
[self-play](../../../evaluation/playtest/README.md),
[judges](../../../evaluation/judges/README.md) and [testing](../../testing.md).
