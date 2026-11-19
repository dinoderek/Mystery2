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
  `age_appropriate_turn` and the `gm_*` judges. A failure found in play can be
  frozen into a runtime case and re-judged against another model.
- **The `gm_*` judges** (`gm_roleplay`, `gm_clue_discipline`,
  `gm_fabrication`, `gm_spoiler`) belong to neither: they live in
  `evaluation/judges/` and read a subject projection (`evaluation/judges/README.md`).
- **Playtest** produces sessions, not grades: an AI investigator plays through
  the real server. `--judge` hands the games to trace.
- **The truth set** holds subjects with known faults to score judges against
  (`evaluation/truth/README.md`).

Readers of a played game skip `no_turn_line` events through `playedEvents` in `evaluation/lib/game-events.ts`.

## Why the blueprint pipeline is shaped this way

The blueprint pipeline catches authoring failures before play and changes
cheaply: a new dimension is files and a registry entry, not code. Every model
call is a subprocess, with no LLM SDK. Judges run in parallel, and a run that
aborts still writes its result.

Two lessons from the single-prompt evaluator it replaced:

- **A narrow judge judges better.** One prompt assessing solvability, fairness,
  coherence and grounding at once gave worse signal on each.
- **What code can check, code checks.** LLM time is the bottleneck and LLM
  judgement drifts. Schema validity, brief-derived counts, orphan clues and lock
  shapes are mechanical; the judge keeps the qualitative questions.

One judge per dimension also buys isolation, targeted retries and, versioned,
re-running only the changed judge (`evaluation/README.md`).

## Three tiers of check

| Tier | What | Where | Runs |
|---|---|---|---|
| Mechanical | Deterministic structural checks | `evaluation/checks/mechanical.ts` | Always |
| Analyzer | Deterministic, per dimension | `evaluation/checks/analyzers/<id>.ts` | If the dimension has one |
| Judge | One LLM call per dimension | `evaluation/dimensions/<id>.md` + `<id>.schema.ts` | Per registered dimension |

A dimension's result is `skipped` if nothing ran, `error` if its analyzer or
judge failed after retries, `fail` if any result failed, else `pass`. The run
summary counts them.

## Stages

`./dev eval judge blueprint` (`evaluation/blueprint/`) loads the blueprint and
its brief, then runs:

1. **Mechanical checks**: the clue graph is acyclic, references real clues,
   and reaches every solution clue from an ungated root; a location lock is a
   pointer a prerequisite points to; a self-protect agenda has a confession and
   parts naming real clues. A failure does not stop the dimensions: judges often
   find the same problem another way.
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
(`evaluation/generator-harness/template/README.md`). The judge's is
`evaluation/judge-harness/template/`.

## Dimensions

`evaluation/core/registry.ts` lists every check and judge once, with the subject
kind each applies to (`blueprint`, `game`, `turn`). Ids are unique across it. A
`candidate` judge runs only when named, as by `--judges`.

`clue_graph` also judges whether each lock's kind fits its fiction;
`character_grounding`, whether each self-protect reaction concedes only what its
clues show.

A blueprint dimension is two files and a registry entry. The brief,
`evaluation/dimensions/<id>.md`, states the judge's questions and its
output. The Zod schema, `<id>.schema.ts`, is appended to the prompt as JSON
Schema and validates the answer; where brief and schema disagree, the schema
wins. The registry entry gives the context, the verdict rule, an optional
analyzer, and `idChecks`, the blueprint ids the answer may cite. Without
`idChecks`, only the answer's shape is checked.

## Deliberately not done yet

- Evaluating several blueprints per brief. Suites sample a judge several times
  (`evaluation/README.md`).
- Storing and browsing run history beyond the run directories.
- Further dimensions (clue economy, red-herring quality, cover-ups, narrative
  economy, tone) are intended but not built.
- Measuring how long a case takes to solve in play.
