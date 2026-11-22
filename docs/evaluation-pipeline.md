# Evaluation

Four harnesses judge the game's AI from different angles. They share one core,
`evaluation/core/`: model runner, config, judge registry, result format and
exit-code rule. This doc is the map and design; the runbook is
`evaluation/README.md`.

| Harness | Subject | Question | Runbook |
|---|---|---|---|
| Blueprint | A blueprint or clue-graph case | Is this a good, fair, solvable mystery? | `evaluation/README.md` |
| Trace | A played session | Did the narrator play it faithfully? | `evaluation/trace/README.md` |
| Runtime | One interaction, fixed history | How does a model narrate this exact turn? | `evaluation/runtime/README.md` |
| Playtest | Nothing — it plays | What happens when an AI plays whole games? | `evaluation/playtest/README.md` |

How they connect:

- **Trace** extracts a played game, read-only, and rebuilds what the narrator
  saw with the runtime's own context builders.
- **Runtime** fixes one interaction's state and history, so the input is the
  same across runs and models, and grades the narration. A failure found in
  play can be frozen into a runtime case and re-judged on another model.
- **The `gm_*` judges** belong to neither: they read a subject projection
  (`evaluation/judges/README.md`).
- **Playtest** produces sessions, not grades: an AI investigator plays the
  real server. `--judge` hands the games to trace.
- **The truth set** holds subjects with known faults to score judges against
  (`evaluation/truth/README.md`).

Readers of a played game skip `no_turn_line` events through `playedEvents` in `evaluation/lib/game-events.ts`.

## Why the blueprint pipeline is shaped this way

The blueprint pipeline catches authoring failures before play and changes
cheaply: a new dimension is files and a registry entry. Every model call is a
subprocess, with no LLM SDK. Judges run in parallel, and a run that aborts
still writes its result.

Two lessons from the single-prompt evaluator it replaced:

- **A narrow judge judges better.** One prompt assessing everything at once
  gave worse signal on each question.
- **What code can check, code checks.** LLM judgement drifts. Schema, counts,
  orphan clues and lock shapes are mechanical; judges keep the qualitative
  questions.

One judge per dimension buys isolation, targeted retries and, versioned,
re-running only the changed judge (`evaluation/README.md`).

## Three tiers of check

| Tier | What | Where | Runs |
|---|---|---|---|
| Mechanical | Deterministic structural checks | `evaluation/checks/mechanical.ts` | Always |
| Analyzer | Deterministic, per dimension | `evaluation/checks/analyzers/<id>.ts` | If the dimension has one |
| Judge | One LLM call per dimension | `evaluation/dimensions/<id>.md` + `<id>.schema.ts` | Per registered dimension |

A dimension's result is `skipped` if nothing ran, `error` if its analyzer or
judge failed after retries, `fail` if any result failed, else `pass`.

## Stages

`./dev eval judge blueprint` (`evaluation/blueprint/`) loads the blueprint and
its brief, then runs:

1. **Mechanical checks**: the clue graph is acyclic, references real clues,
   and reaches every solution clue from an ungated root; a location lock is a
   pointer naming the spot (`searchNamesSpot`); a self-protect agenda has a
   confession, hidden steps and parts naming real clues; no description names
   a locked spot. A failing check still lets the judges run.
2. **Dimensions**, in parallel. Within one, the analyzer runs before the judge,
   and an analyzer error skips only that dimension's judge.

`./dev generate` makes the blueprint first, then runs the same checks.

## Clue-graph cases

A clue-graph case (`docs/clue-graph.md`) needs no brief. Its check,
`clue_graph_valid`, is `validateClueGraph`. Its judges, `cg_soundness`,
`cg_truth_agreement`, `cg_character_grounding` and `cg_step_sense`, fail on a
major finding and are told what the validator checks, so they judge only what
the facts mean. Step sense also reads the player's view
(`evaluation/blueprint/player-view.ts`): what can be held when, and what leads
to each step. A judge is trusted once it passes both hand-written stories and
fails a broken copy of each, which breaks one thing per judge
(`evaluation/blueprint/clue-graph-breaks.ts`).

## Workspaces

Generation and judging each run an agent in a one-shot **workspace**: its
inputs, reference docs, a validator it must pass and fix its mistakes against,
and an output path. The workspace records everything the agent saw. The generator's workspace
(`evaluation/generator-harness/template/`) gets curated extracts of the repo docs,
pinned to the sections they summarise and checked by the gate
(`evaluation/generator-harness/template/README.md`). The judge's is
`evaluation/judge-harness/template/`.

## Dimensions

`evaluation/core/registry.ts` lists every check and judge once, with the subject
kind each applies to (`blueprint`, `game`, `turn`), and a blueprint's `format`.
Ids are unique across it. A `candidate` judge runs only when named.

`clue_graph` also judges whether each lock's kind fits its fiction;
`character_grounding`, whether each self-protect reaction concedes only what its
clues show.

A blueprint dimension is two files and a registry entry. The brief,
`evaluation/dimensions/<id>.md`, states the judge's questions. The Zod schema,
`<id>.schema.ts`, is appended to the prompt as JSON Schema and validates the
answer; it wins over the brief. The entry gives the context, the verdict rule,
an optional analyzer, and `idChecks`, the ids the answer may cite.

## Deliberately not done yet

- Several blueprints per brief; suites sample a judge several times instead.
- Run history beyond the run directories.
- Further dimensions (clue economy, red herrings, cover-ups, tone).
- Measuring how long a case takes to solve in play.
