# Shared game-master judges

These judges ask whether the AI **game master** honored the blueprint. That
question does not depend on how the narration was produced, so the briefs and
output schemas live here, outside both harnesses. Each harness projects its own
data into one shared subject:

| Harness | Subject | Judged turns | Bound as |
|---|---|---|---|
| `evaluation/trace/` | a whole played session, reconstructed from the game database | every turn | registry judges for a `game` |
| `evaluation/runtime/` | ONE replayed interaction | exactly one — the action under test | registry judges for a `turn` |

So a failure found on a played trace can be frozen into a runtime case
(`./dev eval cases`) and re-judged by the same standard against another model
or prompt.

## The battery

| Id | Asks | Typical `major` |
|---|---|---|
| `gm_roleplay` | Does the game master perform the authored character, and the required narrator voice? | An unearned persona flip; ignoring an active high-priority agenda; firing a gated tell early; a character speaking another's private knowledge |
| `gm_clue_discipline` | Were the right clues released, at the right time, and recorded? | Narration delivers a clue that was not recorded (or records one it never delivered); a `requires`-gated clue released early without declaring it off-script |
| `gm_fabrication` | Did the game master invent material facts the blueprint does not support? | An invented person, place, or searchable object; a claim contradicting the blueprint or the game master's own earlier turn |
| `gm_spoiler` | Did pre-accusation narration give away ground truth? | Naming the culprit; stating the motive or mechanism as fact; confirming the player's guess before the endgame |

These are four narrow judges, not one "blueprint adherence" judge, for the
reasons in `docs/evaluation-pipeline.md` ("Three tiers of check"). Each brief
states its boundaries with its siblings, so a defect is not reported four times.

## The subject

`subject.ts` projects each harness's data into a list of turns, each with its
input, narration and revealed clues. Two fields carry the design:

- `judged`. A runtime case's prior history is a **fixture**, not the model's
  output, so those turns are context the judge reads but never faults. A trace
  has no fixture, so every turn is judged. Without the flag, every runtime case
  would be marked down for its own setup.
- `prior_revealed_clue_ids`. The judge compares a clue's `requires.clue_ids`
  against what the player demonstrably had, so gating is judgeable from either
  subject without the runtime's internal `prereqs_met` flag.

## The verdict rule

Every judge returns `findings[]`, each `minor` or `major`, plus its own
`verdict`. **`resolveVerdict()` fails a dimension iff it has at least one `major`
finding.** When the stated `verdict` disagrees with the findings, the findings
win and the disagreement is recorded as `verdict_disagreement`. Both harnesses
apply the rule, so a `fail` means the same in a game result and a runtime
`result.json`.

## Adding a judge

Two files and one registry entry. Underscores in the id become hyphens in the
file names (`gm_spoiler` → `gm-spoiler.md`).

1. `evaluation/judges/<id>.md`: the prose contract. It says what the judge asks,
   the judging procedure, what is *not* a finding, and the output shape. It
   states the boundary with the sibling judges.
2. `evaluation/judges/<id>.schema.ts`: a named `schema` export (Zod). The
   composer appends it to the system prompt as JSON Schema, and the validator
   checks the reply against it. Where prose and schema disagree, the schema wins.
3. An entry in `evaluation/core/registry.ts`, the one list of every check and
   judge. It gives the id (unique across the list), the subject kinds it applies
   to (`game` and `turn` here), the brief, schema and preamble paths, and the
   verdict rule (`major_findings` here).

Keep the common finding fields (`sequence`, `severity`, `quote`, `why`,
`refers_to`) and vary only the `kind` enum, so consumers read findings from any
judge in the battery without special-casing.

## Cost and offline testing

Each judge is one model call per subject, and the four run in parallel. The trace
pipeline runs all four on every trace; the runtime harness makes them opt-in
(`evaluation/runtime/README.md`, "What a run costs"). For wiring checks with no
model, `judge-stub` answers with a canned clean verdict:

```bash
./dev eval judge turn <cases> --narrator narrator-stub --judges gm_spoiler --judge-binding judge-stub
```

The tests (`tests/api/unit/judges-*.test.ts`,
`tests/api/unit/runtime-adherence-judge.test.ts`) cover the projection, schemas and
verdict rule this way. Do not read `gm_roleplay` findings on the `narrator-stub`
narrator: its canned line is blueprint-blind.
