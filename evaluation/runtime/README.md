# Judging a turn

Grades one narration on fixed state and history. Options: `evaluation/README.md`.

## Determinism is the point

A case is **one action** on a **fully specified prior state**: the history is
part of the case, not played, so the input is identical on every run.

## Choosing a narrator

`--narrator` takes a list, each fed identical input.

| Narrator | Narration comes from | Needs |
|---|---|---|
| `narrator-claude`, `narrator-openai` | a real model, called by the harness | that CLI on PATH (`OPENAI_API_KEY` for openai) |
| `server` (the default) | the game, on a throwaway server | a build; `--ai-profile` names the AI |
| `narrator-stub` | a canned shell script | nothing |

To grade a model, use `narrator-claude` (no server or database); `--model-override narrator-claude=<model>` picks it. `server`
puts the game in the loop, validating clue reveals.

The stub proves only the plumbing. `narrator-claude` runs with no
tools, MCP servers or settings (`config/wrappers/claude-runtime.sh`), so the
model under test never reads `CLAUDE.md`.

### The throwaway server

A `server` run starts the app against a temporary config root
(`scripts/lib/test-server.mjs`), seeds each case's history, sends the action as
a typed line, and removes the root, never touching your play database. A case setting
`accusation_history_mode` needs a CLI narrator: a typed line cannot carry it. An `--ai-profile` other than `mock` or `default` (mock on the fresh
database) comes from the config root's `ai.json` with its key; a missing name
or key fails the run first.

## Cases

A case is a blueprint, a `given` state (mode, location, time, the full `history`),
exactly one `action`, and the judges to run. A case file (`.ts`, `.mjs`, `.json`)
holds one case or a list; a folder runs every case file in it; `evaluation/runtime/cases/age-readability.ts` is an
annotated example. `history` rows have the shape the runtime stores in
`game_events`; a clue-graph case's carry `payload.clue_graph`, and a server run seeds its
snapshot ([`docs/clue-graph.md`](../../docs/clue-graph.md)). Action types and modes: `ACTIONS` in
`evaluation/runtime/lib/roles.ts`.

`evaluation/runtime/cases/all-interactions.ts` is the coverage baseline: one case
per narrator interaction (`InteractionId` in `packages/shared/src/age-profile.ts`).

## Judges

- `flesch`, a check: the deterministic Flesch–Kincaid grade against the
  blueprint's `target_age`.
- `age_appropriate_turn`, a judge for what the formula cannot see (vocabulary,
  figurative language), against the narrator prompt's age profile; not the
  blueprint dimension `age_appropriate`.
- `gm_roleplay`, `gm_clue_discipline`, `gm_fabrication`, `gm_spoiler`: the
  adherence judges shared with the game harness (`evaluation/judges/README.md`).
  The history is context; the action is the one judged turn.

**Which judges run:** `--judges a,b`, else the case's `judges`, else none (a
stored turn: below).

**Options** go in the case's `judgeConfig.<judge>`: `tolerance` (`flesch`, grade
levels above target, default 2), `targetAge` (`flesch`, `age_appropriate_turn`) and
`blueprintPath` (`gm_*`). Every model judge calls the `turn-judge` binding;
`--judge-binding judge-stub` answers with a fixed pass. A binding that cannot run
stops the run before anything is replayed.

**Cost:** calls are cases × narrators × samples × (model judges + 1 for a model
narrator, 2 for a clue-graph accusation); `flesch` and `expect` are free.

## Expected outcomes

A `search`, `ask` or clue-graph `accuse` case may carry `expect`, graded by code against the
narrator's output as the game reads it: `revealed_clue_id` (search; an id or
`null`), `revealed_clue_ids` and `used_clue_ids` (sets), `input_understood`.
`expect.judges` maps a turn judge to the way its fail
errs (`withheld`, `given_away`, `either`); it always runs. See
`cases/expect-example.ts`. On a clue graph, `whole_fact` lists an expected
clue's details (spellings each): its notebook line, and the narration or the
player's words it answers, must hold each. A tell riding on a
statement counts with it.

An accusation chains the game's steps: the narrator reports the name and the
citations, the engine decides, the narrator words the reply. `verdict`
(`win`, `not_yet`, `lose`) and `reply_kind` (`flaw`, `alternative`, `missing`)
grade the decision; the narration must hold each `handed` detail (spellings
each) of what the engine handed the reply.

It runs `--samples` times per narrator (default 5), as `<case>__<narrator>__s<n>`.
A wrong sample **withheld** (an expected clue, use or handed detail missing), **gave away** (one
not expected), **misread** (an accusation: another verdict or reply kind), or was **judged** (an `either` judge failed); one that
withheld on a case expecting a use went **unseen** (use missing) or was **refused**.
`expect.json`, also printed, holds each case's and `group`'s share
right; `ungraded: true` keeps a case out of its group. A sample that did not run
or could not be graded, such as a give-away a server refuses, counts neither way
and marks the run INCOMPLETE.

`./dev eval baseline save <run> <file>` stores a complete run's summary, by
convention as `<case folder>/baselines/<model>.json`;
`baseline compare <baseline> <run>` prints each case's and group's change.
`cases/search-reveals/` and `cases/talk-reveals/` have `haiku`, `sonnet` and
`<model>-after` baselines. Each `cases/clue-graph/` story has
`haiku` and `sonnet`; ported greenhouse cases keep their IDs. Its `whole-fact`,
`plain-unknown` and `invention` groups, with `gm_clue_discipline` and
`gm_fabrication`, measure [the narrator's judgement](../../docs/clue-graph.md);
its `accuse-*` groups, one per kind of accusation, with `gm_spoiler` on each
failure, measure the accusation. Each case and group scores at least 4 of 5.

## Running

```bash
# Plumbing, no model:
./dev eval judge turn evaluation/runtime/cases/all-interactions.ts --narrator narrator-stub --judges flesch

# Graded cases, on one model:
./dev eval judge turn evaluation/runtime/cases/expect-example.ts \
  --narrator narrator-claude --model-override narrator-claude=haiku

# The adherence judges:
./dev eval judge turn evaluation/runtime/cases/age-readability.ts \
  --narrator narrator-claude --judges gm_roleplay,gm_clue_discipline,gm_fabrication,gm_spoiler
```

Each case × narrator is one subject, `<case>__<narrator>/`: `turn.json` (the raw
capture, written **before** any judge runs) and `result.json`. A failed narrator exits 1; a judge that fails or cannot judge exits 2.

To re-judge a stored turn without calling its narrator:

```bash
./dev eval judge turn <run>/<case>__<narrator>/turn.json
```

It runs the judges of the `result.json` beside it, else `flesch`, or `--judges
a,b`, into a new run, with default options and no grade (`judgeConfig` and
`expect` are not stored).

### Cases from a played game

`./dev eval cases <trace.json>` turns a stored trace (`evaluation/trace/README.md`)
into cases: an event becomes one, its pre-event state and earlier events as
`given`; see `--help`.

Given the trace itself, `judge turn` judges each narrated turn's own narration
with `flesch` and `age_appropriate_turn`, by event sequence, calling no narrator.

## Adding things

- **A judge**: a registry entry listing `turn` among its subjects
  (`evaluation/judges/README.md`).
- **An action**: an `ACTIONS` entry with its `line`, `roleInput` and `speaker`.

## Tests

`tests/api/unit/runtime-*` and `judges-*` run on stub bindings;
`tests/api/integration/eval-turn-server.test.ts` replays through a throwaway
server on the mock. No test calls a model.
