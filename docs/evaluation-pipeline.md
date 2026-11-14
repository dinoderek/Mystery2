# Evaluation

Four harnesses judge the game's AI from different angles. They share one core,
`evaluation/core/`: one model runner, one config file, one judge registry, one
result format and one exit-code rule. This doc is the map and design; the
runbook is `evaluation/README.md`.

| Harness | Subject | Question | Runbook |
|---|---|---|---|
| Blueprint | A generated blueprint | Is this a good, fair, solvable mystery? | `evaluation/README.md` |
| Trace | A played session | Did the narrator play it faithfully? | `evaluation/trace/README.md` |
| Runtime | One interaction, fixed history | How does a model narrate this exact turn? | `evaluation/runtime/README.md` |
| Playtest | Nothing — it plays | What happens when an AI plays whole games? | `evaluation/playtest/README.md` |

How they connect:

- **Trace** extracts a played game from the play database, read-only, and
  rebuilds what the narrator saw with the runtime's own context builders.
- **Runtime** fixes one interaction's prior state and history, so the input is
  identical across runs and models. It grades the narration with `flesch`,
  `age_appropriate_turn` and the `gm_*` judges. A failure found in play can be frozen into a runtime case
  and re-judged against another model by the same standard.
- **The `gm_*` judges** (`gm_roleplay`, `gm_clue_discipline`,
  `gm_fabrication`, `gm_spoiler`) belong to neither: they live in
  `evaluation/judges/` and read a subject projection (`evaluation/judges/README.md`).
- **Playtest** produces sessions, not grades: an AI investigator plays through
  the real server. `--judge` hands the games to trace.

Every reader of a played game's events skips `no_turn_line`, the event a refused
line or `help` is saved as. The shared filter `playedEvents` in
`evaluation/lib/game-events.ts` does this.

## Why the blueprint pipeline is shaped this way

The blueprint pipeline generates a Blueprint V2 from a brief and judges it; the
other harnesses inherit its design. It catches authoring failures before play,
and it is built to change cheaply: a new dimension is files and a registry entry,
not code. Every model call is a subprocess, with no LLM SDK. Judges run in
parallel, and a run that aborts still writes its result.

Two lessons from the single-prompt evaluator it replaced:

- **A narrow judge judges better.** One prompt assessing solvability, fairness,
  coherence and grounding at once gave worse signal on each.
- **What code can check, code checks.** LLM time is the bottleneck and LLM
  judgement drifts. Schema validity, brief-derived counts and orphan clues are
  mechanical; the judge keeps the genuinely qualitative questions.

One judge per dimension also buys isolation (editing the fairness prompt cannot
move solve-depth scores) and targeted retries.

## Three tiers of check

| Tier | What | Where | Runs |
|---|---|---|---|
| Mechanical | Deterministic structural checks | `evaluation/checks/mechanical.ts` | Always |
| Analyzer | Deterministic, per dimension | `evaluation/checks/analyzers/<id>.ts` | If the dimension has one |
| Judge | One LLM call per dimension | `evaluation/dimensions/<id>.md` + `<id>.schema.ts` | Per registered dimension |

A dimension's result is `skipped` if nothing ran, `error` if its analyzer or
judge failed after retries, `fail` if any result failed, else `pass`. The run
summary counts them; consumers decide what is ship-ready.

## Stages

`./dev eval judge blueprint` (`evaluation/blueprint/`), on the core, loads the
blueprint and its brief, then runs:

1. **Mechanical checks**: the clue discovery graph is acyclic, references real
   clues, and reaches every solution clue from an ungated root. A failure does not
   stop the dimensions, since judges often find the same problem another way.
2. **Dimensions**, in parallel. Within one, the analyzer runs before the judge,
   and an analyzer error skips only that dimension's judge.

`./dev eval generate` makes the blueprint first, then runs the same checks.

## Workspaces

Generation and judging each run an agent in a one-shot **workspace**: the brief,
its inputs, reference docs, a validator it must pass, and an output path. The
agent runs its own validator and fixes its mistakes, and the workspace records
everything it saw, so a bug can be reproduced. The generator's workspace
(`evaluation/generator-harness/template/`) gets curated extracts of the repo docs,
pinned to the sections they summarise and checked by the gate
(`evaluation/generator-harness/template/README.md`).

## Dimensions

`evaluation/core/registry.ts` lists every check and judge once, with the subject
kind each applies to (`blueprint`, `game`, `turn`). Ids are unique across it. One
loader, prompt composer and output validator in `evaluation/core/` serve every
harness.

A blueprint dimension is two files and a registry entry. The brief,
`evaluation/dimensions/<id>.md`, says what the judge asks and documents its
output. The Zod schema, `<id>.schema.ts`, is appended to the prompt as JSON
Schema and validates the answer; where brief and schema disagree, the schema
wins. The registry entry gives the context, the verdict rule, an optional
analyzer, and `idChecks`, the blueprint ids the answer may cite.

## Deliberately not done yet

- Evaluating several blueprints per brief, or sampling a judge several times and
  voting.
- Storing and browsing run history beyond the run directories.
- Further dimensions (clue economy, red-herring quality, cover-ups, narrative
  economy, tone) are intended but not built.
- Measuring how long a case takes to solve in play, which is a runtime concern.
