# Shared game-master judges

These judges ask whether the AI **game master** honored the blueprint. That
question does not change with how the narration was produced, so the briefs and
their output schemas live here, outside both harnesses, and each harness
projects its own data into one shared subject:

| Harness | Subject | Judged turns | Bound as |
|---|---|---|---|
| `evaluation/trace/` | a whole played session, reconstructed from the game database | every turn | registry dimensions (`evaluation/trace/dimensions/registry.json`) |
| `evaluation/runtime/` | ONE replayed interaction | exactly one — the action under test | judges (`--judges`, or a case's `judges`) |

So a failure found on a played trace can be frozen into a runtime case
(`evaluation/runtime/cases-from-trace.mjs`) and re-judged by the same standard
against another model or prompt, without replaying a game.

## The battery

| Id | Asks | Typical `major` |
|---|---|---|
| `gm_roleplay` | Does the game master perform the authored character, and the required narrator voice? | An unearned persona flip; ignoring an active high-priority agenda; firing a gated tell early; a character speaking another's private knowledge |
| `gm_clue_discipline` | Were the right clues released, at the right time, and recorded? | Narration delivers a clue that was not recorded (or records one it never delivered); a `requires`-gated clue released early without declaring it off-script |
| `gm_fabrication` | Did the game master invent material facts the blueprint does not support? | An invented person, place, or searchable object; a claim contradicting the blueprint or the game master's own earlier turn |
| `gm_spoiler` | Did pre-accusation narration give away ground truth? | Naming the culprit; stating the motive or mechanism as fact; confirming the player's guess before the endgame |

They are four narrow judges rather than one "blueprint adherence" judge, for
the reasons in `docs/evaluation-pipeline.md` → "Three tiers of check". Each
brief states its boundaries with its siblings so the same defect is not
reported four times.

## The subject

Each judge is a brief and a Zod schema in this directory, behind a shared
evaluator preamble (`prompts/judge-system.md`). `subject.mjs` projects each
harness's data into the subject: a list of turns, each with its input,
narration and revealed clues. Two fields carry the design.

`judged` is the load-bearing field. A runtime case authors its prior history as
a **fixture** — the model did not write it — so those turns are context the
judge reads but never faults. A trace has no fixture: every turn is the game
master's own output, so every turn is judged. Without the flag, every runtime
case would be marked down for its own setup.

`prior_revealed_clue_ids` is what makes gating judgeable from either subject:
the judge does not need the runtime's internal `prereqs_met` flag, it compares a
clue's `requires.clue_ids` against what the player demonstrably already had.

## The verdict rule

Every judge returns `findings[]`, each `minor` or `major`, plus its own
`verdict`. **`resolveVerdict()` fails a dimension iff it has at least one
`major` finding.** When the stated `verdict` disagrees with the findings, the
findings win and the disagreement is recorded as `verdict_disagreement`: a
judge that lists a major defect and then says "pass" is worth seeing while
iterating on a brief.

Both harnesses apply this rule, so a `fail` means the same thing in a trace
envelope and in a runtime `result.json`.

## Adding a judge

Two files, then two registrations. Underscores in the id become hyphens in the
file names (`gm_spoiler` → `gm-spoiler.md`).

1. `evaluation/judges/<id>.md` — the prose contract: what it asks, the judging
   procedure, what is explicitly *not* a finding, and the documented output
   shape. State the boundary with the sibling judges.
2. `evaluation/judges/<id>.schema.ts` — a named `schema` export (Zod). The
   pipeline serializes it to JSON Schema, appends it to the system prompt, and
   validates the reply against it. Where prose and schema disagree, the schema
   wins.

Then add the id to `ADHERENCE_JUDGE_IDS` in `index.mjs`, which registers it with
the runtime harness, and to `evaluation/trace/dimensions/registry.json`, which
adds it to the trace battery.

Keep the common finding fields — `sequence`, `severity`, `quote`, `why`,
`refers_to` — and vary only the `kind` enum. Consumers read findings from any
judge in this battery without special-casing.

## Cost and offline testing

Each judge is one model call per subject, and the four run in parallel. The
trace pipeline runs all four on every trace (when its `cli.json` exists;
otherwise each is `skipped`). The runtime harness would make four calls per
case per backend, so there they are opt-in (`evaluation/runtime/README.md` →
"What a run costs").

For wiring checks with no model, use the deterministic `judge-stub`, which
emits a canned clean verdict:

```bash
node evaluation/runtime/run.mjs <cases> --backend cli:stub --judges gm_spoiler
```

with `judgeConfig: { gm_spoiler: { cli: "judge-stub" } }` on the case. The unit
tests (`tests/api/unit/judges-*.test.ts`,
`tests/api/unit/runtime-adherence-judge.test.ts`) cover the projection, the
schemas and the verdict rule this way. Do not read `gm_roleplay` findings on
the `cli:stub` narrator: its canned line is blueprint-blind.
