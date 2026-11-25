# Judging a turn

Grades fixed-state narration; options: `evaluation/README.md`.

## Determinism is the point

A case is **one action** on a **fully specified prior state**: the history is
given, not played, so every run sees identical input.

## Choosing a narrator

`--narrator` takes a list.

| Narrator | Narration comes from | Needs |
|---|---|---|
| `narrator-*` | a model through its CLI wrapper | the binding's credentials and executable |
| `server` (the default) | the game, on a throwaway server | a build; `--ai-profile` names the AI |
| `narrator-stub` | a canned shell script | nothing |

`--model-override narrator-claude=<model>` selects the Claude model; `server`
also applies engine reveal checks. Claude runs without tools, MCP or settings.

### The throwaway server

A `server` run starts the app on a temporary root
(`scripts/lib/test-server.mjs`), seeds each case's history, sends the action as
a typed line, and removes the root; your play database is untouched. A case setting
`accusation_history_mode` needs a CLI narrator. An `--ai-profile` other than `mock` or `default` comes from `ai.json` with its key; a missing one fails the run first.

## Cases

A case holds a blueprint, `given` state (mode, location, time, full `history`),
one `action`, and judges. A case file (`.ts`, `.mjs`, `.json`)
holds one case or a list; a folder runs each file in it
(`evaluation/runtime/cases/clue-graph/mock-case/readability.ts` is annotated).
A case fails before any call if its blueprint is no clue graph or
names a character it lacks. `history` rows have the shape the runtime stores in
`game_events`; a clue-graph case's carry `payload.clue_graph`, which a server run seeds ([`docs/clue-graph.md`](../../docs/clue-graph.md)). Action types and modes: `ACTIONS` in
`evaluation/runtime/lib/roles.ts`.

`mock-case/all-interactions.ts` covers each narrator interaction
(`InteractionId`, `packages/shared/src/age-profile.ts`) once.

## Judges

- `flesch`, a check: the deterministic Flesch–Kincaid grade against the
  blueprint's `target_age`.
- `age_appropriate_turn`, a judge for what the formula misses (vocabulary,
  figurative language), against the narrator prompt's age profile.
- `gm_roleplay`, `gm_clue_discipline`, `gm_fabrication`, `gm_spoiler`: the
  adherence judges shared with the game harness (`evaluation/judges/README.md`).
  Only the action is judged; the history is context.

**Which judges run:** `--judges a,b`, else the case's `judges`, else none.

**Options** go in the case's `judgeConfig.<judge>`: `tolerance` (`flesch`, grade
levels above target, default 2), `targetAge` (`flesch`, `age_appropriate_turn`) and
`blueprintPath` (`gm_*`). Every model judge calls the `turn-judge` binding
(`--judge-binding judge-stub` always passes); one that cannot run
stops the run before any replay.

**Cost:** calls are cases × narrators × samples × (model judges + 1 for a model
narrator, 2 for an accusation); `flesch` and `expect` cost nothing.

## Expected outcomes

A `search`, `ask` or clue-graph `accuse` case may carry `expect`, graded by code against the
narrator's output as the game reads it: `revealed_clue_id` (search; an id or
`null`), `revealed_clue_ids` and `used_clue_ids` (sets), `input_understood`.
`expect.judges` maps a turn judge to how its fail
errs (`withheld`, `given_away`, `either`); it always runs. See
`cases/clue-graph/mock-case/expect.ts`. `whole_fact` lists an expected
clue's details (spellings each): its notebook line, and the narration or the
player's words it answers, must hold each. A tell riding on a
statement counts with it.

An accusation chains the game's steps: the narrator reports the name and
citations, the engine decides, the narrator words the reply. `verdict`
(`win`, `not_yet`, `lose`) and `reply_kind` (`flaw`, `alternative`, `missing`)
grade the decision; the narration must hold each `handed` detail.

It runs `--samples` times per narrator (default 5): `<case>__<narrator>__s<n>`.
A wrong sample **withheld** (an expected clue, use or handed detail missing), **gave away** (one
not expected), **misread** (an accusation: another verdict or reply kind), or was **judged** (an `either` judge failed); one that
withheld on a case expecting a use went **unseen** or was **refused**.
`expect.json`, also printed, holds each case's and `group`'s share
right; `ungraded: true` keeps a case out of its group. A sample that did not run
or be graded counts neither way: the run is INCOMPLETE.

`./dev eval baseline save <run> <file>` retains a complete summary;
`baseline compare <baseline> <run>` prints changes; `baseline status` marks
each baseline current or stale against `HEAD`, listing commits since its
run touching what runs read (`READ_PATHS` in `evaluation/core/baseline-status.ts`). It compares content, as squash merges leave a run's commit off
`main`, exits 0, and prints in CI.

### Baseline policy

- A baseline is evidence only for its own commit.
- Anyone may change a brief, prompt or engine code: the gate forces the version
  entry and snapshots, and `baseline status` shows the baselines stale.
- Others need only `npm test`.
- A stale baseline is refreshed on demand, before a comparison relies on it; a
  live rebaseline explains each difference by the commits listed.
- When several commits were batched, it replays at commit boundaries to
  attribute them.

## Running

```bash
# No model:
./dev eval judge turn evaluation/runtime/cases/clue-graph/mock-case/all-interactions.ts --narrator narrator-stub --judges flesch

# Graded cases:
./dev eval judge turn evaluation/runtime/cases/clue-graph/mock-case/expect.ts \
  --narrator narrator-claude --model-override narrator-claude=haiku

# Two gm judges:
./dev eval judge turn evaluation/runtime/cases/clue-graph/mock-case/readability.ts \
  --narrator narrator-claude --judges gm_roleplay,gm_spoiler
```

Each subject holds `turn.json` (captured before judging) and `result.json`.
A narrator failure exits 1; a judge's, 2.

To re-judge a stored turn:

```bash
./dev eval judge turn <run>/<case>__<narrator>/turn.json
```

Re-judging uses the adjacent result's judges, else `flesch`, or `--judges a,b`,
with default options: `judgeConfig` and `expect` are unstored.

### Cases from a played game

`./dev eval cases <trace.json>` exports supported events with their pre-state
(`evaluation/trace/README.md`). Given the trace itself, `judge turn` judges
each narrated turn with `flesch` and `age_appropriate_turn`, calling no narrator.

## Adding things

A judge is a registry entry listing `turn` among its subjects
(`evaluation/judges/README.md`); an action is an `ACTIONS` entry (`line`,
`roleInput`, `speaker`).

## Tests

`tests/api/unit/runtime-*` and `judges-*` use stubs;
`tests/api/integration/eval-turn-server.test.ts` replays through a throwaway
server. No test calls a model.
