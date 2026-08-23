# Shared game-master judges

One battery of judges, two subjects.

These judges ask whether the AI **game master** honored the blueprint. That
question does not change with how the narration was produced, so the briefs and
their output schemas live here — outside both harnesses — and each harness
projects its own data into one shared subject shape:

| Harness | Subject | Judged turns | Bound as |
|---|---|---|---|
| `evaluation/trace/` | a whole played session, reconstructed from Supabase | every turn | registry dimensions (`dimensions/registry.json`) |
| `evaluation/runtime/` | ONE replayed interaction | exactly one — the action under test | judges (`--judges`, or a case's `judges`) |

The payoff is that a failure found on a played trace can be frozen into a
deterministic runtime case (`evaluation/runtime/cases-from-trace.mjs`) and
re-judged **by the same standard, on the same prompt**, against a different
model or a changed prompt — without replaying a game.

## The battery

| Id | Asks | Typical `major` |
|---|---|---|
| `gm_roleplay` | Does the game master perform the authored character, and the required narrator voice? | An unearned persona flip; ignoring an active high-priority agenda; firing a gated tell early; a character speaking another's private knowledge |
| `gm_clue_discipline` | Were the right clues released, at the right time, and recorded? | Narration delivers a clue that was not recorded (or records one it never delivered); a `requires`-gated clue released early without declaring it off-script |
| `gm_fabrication` | Did the game master invent material facts the blueprint does not support? | An invented person, place, or searchable object; a claim contradicting the blueprint or the game master's own earlier turn |
| `gm_spoiler` | Did pre-accusation narration give away ground truth? | Naming the culprit; stating the motive or mechanism as fact; confirming the player's guess before the endgame |

The dimensions are deliberately narrow and separate rather than one
"blueprint adherence" judge — the same reasoning as the blueprint battery
(`docs/evaluation-pipeline.md` → "Why one judge per dimension"): they run in
parallel, editing the roleplay brief cannot regress spoiler scores, and a schema
failure retries one judge instead of all four. Each brief states its boundaries
with its siblings so the same defect is not reported four times.

## Layout

```
evaluation/judges/
├── index.mjs                 # id -> definition loader, prompt composer, verdict rule
├── subject.mjs               # the two projections into the shared subject shape
├── prompts/judge-system.md   # evaluator preamble shared by both harnesses
├── gm-roleplay.md            # one brief + one Zod schema per judge
├── gm-roleplay.schema.ts
├── gm-clue-discipline.md
├── gm-clue-discipline.schema.ts
├── gm-fabrication.md
├── gm-fabrication.schema.ts
├── gm-spoiler.md
└── gm-spoiler.schema.ts
```

## The subject

Both harnesses produce the same object (see `subject.mjs`):

```jsonc
{
  "subject_kind": "trace" | "interaction",
  "turns": [
    {
      "sequence": 3,
      "judged": true,              // false = fixture/context, never a finding
      "role_name": "talk_conversation",
      "location_id": "loc-kitchen",
      "character_id": "char-alice",
      "player_input": "Then why are your hands shaking?",
      "search_query": null,
      "revealed_clue_ids": ["clue-crumb"],
      "revealed_off_script": [],
      "prior_revealed_clue_ids": ["clue-wrapper"],  // what the player already held
      "narration": "…",
      "is_accusation_phase": false
    }
  ],
  "judged_sequences": [3]
}
```

`judged` is the load-bearing field. A runtime case authors its prior history as
a **fixture** — the model did not write it — so those turns are context the
judge reads but never faults. A trace has no fixture: every turn is the game
master's own output, so every turn is judged. Without the flag, every runtime
case would be marked down for its own setup.

`prior_revealed_clue_ids` is what makes gating judgeable from either subject:
the judge does not need the runtime's internal `prereqs_met` flag, it compares a
clue's `requires.clue_ids` against what the player demonstrably already had.

## The verdict rule

Every judge in this battery returns `findings[]` with a `severity` of `minor` or
`major`, plus its own `verdict`. **`resolveVerdict()` fails a dimension iff it
has at least one `major` finding.** When the model's stated `verdict` disagrees
with its own findings, the findings win and the disagreement is recorded
(`verdict_disagreement`) rather than silently resolved — a judge that lists a
major defect and then says "pass" is worth seeing while iterating on a brief.

Both harnesses apply this same rule, so a `fail` means the same thing in a trace
envelope and in a runtime `result.json`.

## Adding a judge

Two files, no code changes:

1. `evaluation/judges/<id>.md` — the prose contract: what it asks, the judging
   procedure, what is explicitly *not* a finding, and the documented output
   shape. State the boundary with the sibling judges.
2. `evaluation/judges/<id>.schema.ts` — a named `schema` export (Zod). The
   pipeline serializes it to JSON Schema, appends it to the system prompt, and
   validates the reply against it. Where prose and schema disagree, the schema
   wins.

Then add the id to `ADHERENCE_JUDGE_IDS` in `index.mjs` (which registers it with
the runtime harness) and to `evaluation/trace/dimensions/registry.json` (which
adds it to the trace battery).

Keep the common finding fields — `sequence`, `severity`, `quote`, `why`,
`refers_to` — and vary only the `kind` enum. Consumers read findings from any
judge in this battery without special-casing.

## Cost and offline testing

Each judge is one model call per subject, and the four run in parallel.

- **Trace**: four calls per run, and they are the default battery — though they
  only fire at all if `evaluation/trace/config/cli.json` exists. Without it the
  run reports mechanical checks only and records each dimension as `skipped`.
- **Runtime**: four calls **per case, per backend**, which is why they are
  opt-in there rather than default judges. The arithmetic is worked through in
  `evaluation/runtime/README.md` → "What a run costs".

For wiring checks with no model:

```bash
# Judge side: the deterministic judge-stub emits a canned clean verdict.
node evaluation/runtime/run.mjs <cases> --backend cli:stub --judges gm_spoiler
```

with `judgeConfig: { gm_spoiler: { cli: "judge-stub" } }` on the case. The unit
tests (`tests/api/unit/judges-*.test.ts`,
`tests/api/unit/runtime-adherence-judge.test.ts`) cover the projection, the
schemas, and the verdict rule this way and run in the standard unit gate.

Note the limit of the `cli:stub` **narrator** fixture: it is blueprint-blind, so
its canned line cannot be in character for an arbitrary character, and
`gm_roleplay` may legitimately flag it. That is the fixture's fault, not the
runtime's. Grade a real model, or stick to `judge-stub` for wiring.
