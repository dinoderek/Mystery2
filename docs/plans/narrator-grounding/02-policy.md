# N2: one shared grounding policy

Depends on: N1 complete in the [milestone](milestone.md). Status: pending.
Use its frozen development set and baseline; do not inspect held-out outputs.

## Outcome

Strengthen general narration behaviour by applying one sourced policy through
the shared high-priority message. Keep model judgement, existing model calls
and existing player-facing and narrator output contracts.

## Decided work

1. Adapt Anthropic's guidance into concise executable instructions, with its
   purpose explained: a child's reasoning must remain worthwhile because facts
   are dependable and earned information is supplied.
2. Use the shared construction introduced in N1 for both live providers and
   runtime evaluation. Cover openings and arrivals as well as structured roles.
3. Keep stable policy in the high-priority message and dynamic material in
   clearly separated data. Remove duplicated grounding rules from individual
   templates where the shared policy now owns them; do not duplicate the whole
   prompt in two messages.
4. Preserve role-specific mechanics and visibility. Never send additional
   solution material to help the narrator ground its answer.
5. Update the owning docs, mocks, tests, narrator/evaluation snapshots
   together. Explain intentional output changes.

## Grounding adaptation

Reference both original pages and their review date in
[AI Runtime](../../ai-runtime.md); link that doc to the canonical runtime text.
Copy the selected principles in adapted language, not the entire web pages.
The model does not fetch a URL at play time.

| Guidance | Required adaptation |
|---|---|
| Admit uncertainty | Unknown facts remain unknown; uncertainty does not excuse withholding an earned clue. |
| Use source excerpts | Locate brief supporting excerpts in the authorised context before composing material claims. |
| Verify claims | Review each case-bearing assertion against support and reveal permission; remove unsupported additions. |
| Restrict external knowledge | Ordinary knowledge cannot create new case evidence, events, sightings or motives. |
| Review and refine | Check the draft before returning the existing output shape. |
| Repeated samples | Measure instability offline; agreement does not establish truth. |

Authored facts and current game rules/state outrank contradictory earlier
narration, drama, persona and brevity. Preserve consistent harmless scenery.
An active authored lie can be performed; a fresh invented lie cannot. Holding a
clue is not using it. An authorised bluff or deduction still earns its result:
the player's claim need not become an established world fact.

Do not demand hidden reasoning or add deliberation to player-visible output.
Draft review happens within each existing call, including both stages of a
clue-graph accusation. Native reasoning can support the existing response;
evidence-map fields, an independent critic or a separate writing call are later
experiments if this approach is insufficient.

Sources, reviewed 2026-11-23:
[grounding](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
and [prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices).

## Session-level design decisions

- Exact policy wording and which existing passages it replaces. Include its
  task order and priority rules without adding story-specific examples.
- Treatment of a prior narration contradicting an authoritative fact, with
  role visibility preserved. Do not invent a new reveal to correct it.
- How draft review fits each existing call without conflicting with
  JSON-only output, authorised lies or simple narration.
- Future runs exclude OpenRouter; agree new bindings and a separate budget.
  Reviews use Codex GPT-6.1 at Medium effort.
  Report model and policy effects separately; do not select a deployment yet.

## Validation and completion

Tests prove player/case text is not promoted into system instructions, policy
coverage across roles, live/replay parity, unchanged context boundaries and
supported output contracts. Use broad adversarial situations rather than
character-name branches. Update the mock and inspect snapshot diffs.

Run the full `npm test` and CI. Report development results, failures and exact
candidate commits/settings. Freeze the final candidates for N3. Remove this
card and its word-budget row; mark N2 complete and remove its milestone link.
