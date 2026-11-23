# Evaluation

Four harnesses judge the game's AI. They share one core, `evaluation/core/`:
model runner, config, judge registry, result format and exit-code rule. This
doc is the map and design; the table names each runbook.

| Harness | Subject | Question | Runbook |
|---|---|---|---|
| Blueprint | A clue-graph case | Is this a good, fair, solvable mystery? | `evaluation/README.md` |
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

Played-game readers skip `no_turn_line` events (`playedEvents`, `evaluation/lib/game-events.ts`).

## Why the blueprint pipeline is shaped this way

The blueprint pipeline catches authoring failures before play and changes
cheaply: a new judge is files and a registry entry. Every model call is a
subprocess, with no LLM SDK. Judges run in parallel, and a run that aborts
still writes its result.

- **A narrow judge judges better.** One prompt assessing everything at once
  gave worse signal on each question.
- **What code can check, code checks.** LLM judgement drifts. The case check
  is `validateClueGraph`; judges keep the qualitative questions.

One judge per dimension buys isolation, targeted retries and, versioned,
re-running only the changed judge (`evaluation/README.md`).

## Stages

`./dev eval judge blueprint` (`evaluation/blueprint/`) loads the case, then
runs:

1. **The case check**, `clue_graph_valid`. A failing check still lets the
   judges run.
2. **Judges**, in parallel, each one model call.

`./dev generate` makes the case first, then runs the same stages. A result is
`skipped` if nothing ran, `error` if a judge failed after retries, `fail` if
any verdict failed, else `pass`.

## Clue-graph cases

A clue-graph case (`docs/clue-graph.md`) is judged with no brief. Its check,
`clue_graph_valid`, is `validateClueGraph`, and under `./dev generate` also its
fit to the brief. Its judges, `cg_soundness`, `cg_truth_agreement`,
`cg_character_grounding` and `cg_step_sense`, fail on a major finding and are told what the validator checks, so they judge only what
the facts mean. Step sense also reads the player's view
(`evaluation/blueprint/player-view.ts`): what can be held when, and what leads
to each step. A judge is trusted once it passes both hand-written stories and
fails a broken copy of each, which breaks one thing per judge
(`evaluation/blueprint/clue-graph-breaks.ts`).

## Workspaces

Generation and judging each run an agent in a one-shot **workspace**: its
inputs, reference docs, a validator it must pass, and an output path. The
workspace records everything the agent saw. The generator's is described in
`evaluation/generator-harness/template/README.md`, the judge's in
`evaluation/judge-harness/template/README.md`.

## Judges

`evaluation/core/registry.ts` lists every check and judge once, with the subject
kind each applies to (`blueprint`, `game`, `turn`). Ids are unique across it. A
`candidate` judge runs only when named.

A case judge is two files and a registry entry. The brief,
`evaluation/dimensions/<id>.md` (underscores become hyphens), states the
judge's questions. The Zod schema,
`<id>.schema.ts`, is appended to the prompt as JSON Schema and validates the
answer; it wins over the brief. The entry gives the verdict rule and
`idChecks`, the case ids the answer may cite.

## Deliberately not done yet

- Several blueprints per brief.
- Run history beyond the run directories.
- Further judges (clue economy, red herrings, tone).
- Measuring how long a case takes to solve in play.
