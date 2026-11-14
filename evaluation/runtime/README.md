# Judging a turn

Grades the runtime narrator, its prompts and the model behind them, one
interaction at a time: a case fixes the state and history, the harness collects
the narration for exactly one action, and checks and judges score it. The
commands and shared options are in `evaluation/README.md`; this harness's place
among the others is in `docs/evaluation-pipeline.md`.

## Determinism is the point

A case evaluates **one action** against a **fully specified prior state**. The
complete history is part of the case, not produced by playing turns, so the model
input is identical on every run and across models. Models fed their own earlier
narration would diverge past comparison.

## Choosing a narrator

`--narrator` decides who writes the narration under test. It takes a list, and
every case runs once per narrator on byte-identical input.

| Narrator | Narration comes from | Needs |
|---|---|---|
| `narrator-claude`, `narrator-openai` | a real model, called by the harness | that CLI on PATH (`OPENAI_API_KEY` for openai) |
| `server` (the default) | the game, on a throwaway server | a build; `--ai-profile` names the profile |
| `narrator-stub` | a canned shell script | nothing |

To grade a model, use `narrator-claude`: the real prompt and the real model, with
no server and no database. Change its model for one run with `--model-override
narrator-claude=<model>`. Use `server` when the game should be in the loop too;
it validates the model's clue reveals before they reach you, which the CLI path
does not.

The canned narrator proves the plumbing offline and says nothing about the
narrator's content; keep stub runs to `flesch`. `narrator-claude` runs with no
tools, MCP servers or settings, so the model under test does not also read this
repo's `CLAUDE.md`.

### The throwaway server

A `server` run starts the app on a free port against a temporary config root
(`scripts/lib/test-server.mjs`, as self-play does), seeds each case's history
there, sends the action as the line a player would type, and removes the root
afterwards. It never writes to the database you play on. A case that sets
`accusation_history_mode` needs a CLI narrator, since a typed line cannot carry
it. The profile resolves as it always does: `mock` needs nothing, and `default` is
whatever `AI_PROVIDER` and `AI_MODEL` name, else mock.

## Cases

A case is a blueprint, a `given` state (mode, location, time, the full `history`),
exactly one `action`, and the judges to run. A case file is `.ts`, `.mjs` or `.json`,
holding one case or a list; `evaluation/runtime/cases/age-readability.ts` is an
annotated example. `history` rows have the shape the runtime stores in
`game_events`. The action types, and the mode each is valid from, are `ACTIONS` in
`evaluation/runtime/lib/roles.ts`.

`evaluation/runtime/cases/all-interactions.ts` is the coverage baseline: one case
per narrator interaction (`InteractionId` in `packages/shared/src/age-profile.ts`).
Every case passes `flesch` on both fixture narrators, so a real failure stands out.

## Judges

- `flesch`, a check: the deterministic Flesch–Kincaid grade against the
  blueprint's `target_age`.
- `age_appropriate_turn`, a judge for what the formula cannot see: vocabulary,
  figurative language, unclear phrasing, against the age profile the narrator
  prompt was built from. It is not the blueprint dimension `age_appropriate`.
- `gm_roleplay`, `gm_clue_discipline`, `gm_fabrication`, `gm_spoiler`: the
  adherence judges shared with the game harness (`evaluation/judges/README.md`).
  Here the case's history is context and the action under test is the one judged
  turn.

**Which judges run:** `--judges a,b`, else the case's `judges`, else the earlier
result's, else `flesch`. No committed case declares a `gm_*` judge, so the battery
is opt-in here; the game harness runs all four.

**Options** go in the case's `judgeConfig.<judge>`: `tolerance` (`flesch`, grade
levels above target, default 2), `targetAge` (`flesch`, `age_appropriate_turn`) and
`blueprintPath` (`gm_*`). Every model judge calls the `turn-judge` binding;
`--judge-binding judge-stub` answers all of them with a fixed pass, for wiring
checks. A binding that cannot run stops the run before anything is replayed.

### What a run costs

Model calls are cases × narrators × model judges; `flesch` is free. On
`all-interactions.ts` (10 cases, which declare `flesch` and `age_appropriate_turn`):

| Command | Calls |
|---|---|
| no `--judges` | 10, one `age_appropriate_turn` per case |
| `--judges flesch` | 0 |
| `--judges gm_roleplay,gm_clue_discipline,gm_fabrication,gm_spoiler` | 40 |
| the same four, `--narrator server,narrator-claude` | 80, plus 10 narrations |

## Running

```bash
# Plumbing, no model calls, no server:
./dev eval judge turn evaluation/runtime/cases/all-interactions.ts --narrator narrator-stub --judges flesch

# Compare two narrators on identical input:
./dev eval judge turn evaluation/runtime/cases/age-readability.ts --narrator server,narrator-claude

# The adherence judges against a real model:
./dev eval judge turn evaluation/runtime/cases/age-readability.ts \
  --narrator narrator-claude --judges gm_roleplay,gm_clue_discipline,gm_fabrication,gm_spoiler
```

Each case × narrator is one subject, `<case>__<narrator>/`, holding `turn.json`
(the raw capture, written **before** any judge runs) and `result.json`. A narrator
that fails leaves a `result.json` with a run error and exits 1; a judge that fails
or cannot judge exits 2.

To judge a stored turn again, which the inner loop uses while iterating on judges,
point the command at its `turn.json`. The narrator is not called, so the config
needs no narrator binding:

```bash
./dev eval judge turn <run>/<case>__<narrator>/turn.json
```

It runs the judges of the `result.json` beside it, else `flesch`, or `--judges
a,b`, and writes a new run. Model judges still call their model. A case's
`judgeConfig` is not stored, so a stored turn uses the default options.

### Cases from a played game

`./dev eval cases <trace.json>` turns a stored trace (`evaluation/trace/README.md`)
into cases. Each event's payload records the state it was generated from, so an
event becomes one case: the pre-event state and every earlier event as `given`,
the event as `action`. By default it samples up to 3 `ask` and 3 `talk` events
across the session, judged by `flesch`; `--types`, `--max`, `--judges` and `--out`
change that.

## Adding things

- **A case**: a file under `evaluation/runtime/cases/`.
- **A judge**: a registry entry that lists `turn` among its subjects
  (`evaluation/judges/README.md`).
- **An action**: an `ACTIONS` entry with its `line`, `roleInput` and `speaker`.
  Prompt assembly belongs in `packages/game-engine/src/role-request.ts`, shared
  by the handler and this harness.

## Tests

Unit tests under `tests/api/unit/` (the `runtime-*` and `judges-*` files) cover the
judges, action mapping, case generation and a whole `judge turn` run on stub
bindings. `tests/api/integration/eval-turn-server.test.ts` replays through a real
throwaway server on the mock provider. None calls a model.
