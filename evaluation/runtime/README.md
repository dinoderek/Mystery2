# Judging a turn

Grades fixed-state narration. Options: `evaluation/README.md`.

## Determinism is the point

A case is **one action** on a **fully specified prior state**: the history is
given, not played, so every run gets identical input.

## Choosing a narrator

`--narrator` takes a list, each fed identical input.

| Narrator | Narration comes from | Needs |
|---|---|---|
| `narrator-*` | a model through its configured CLI wrapper | the binding's credentials and executable |
| `server` (the default) | the game, on a throwaway server | a build; `--ai-profile` names the AI |
| `narrator-stub` | a canned shell script | nothing |

`--model-override narrator-claude=<model>` selects the Claude model. `server`
additionally applies engine reveal checks.

Claude runs without tools, MCP or settings. The historical OpenRouter wrapper
is `config/wrappers/openrouter-runtime.sh`.

### The throwaway server

A `server` run starts the app against a temporary config root
(`scripts/lib/test-server.mjs`), seeds each case's history, sends the action as
a typed line, and removes the root, never touching your play database. A case setting
`accusation_history_mode` needs a CLI narrator: a typed line cannot carry it. An `--ai-profile` other than `mock` or `default` (mock on the fresh
database) comes from the config root's `ai.json` with its key; a missing name
or key fails the run first.

## Cases

A case contains a blueprint, `given` state (mode, location, time, full `history`),
one `action`, and judges. A case file (`.ts`, `.mjs`, `.json`)
holds one case or a list; a folder runs every case file in it;
`evaluation/runtime/cases/clue-graph/mock-case/readability.ts` is an annotated
example. Before any call, a case is refused if its blueprint is not a clue graph, or
it names a character the blueprint lacks. `history` rows have the shape the runtime stores in
`game_events`; a clue-graph case's carry `payload.clue_graph`, and a server run seeds its
snapshot ([`docs/clue-graph.md`](../../docs/clue-graph.md)). Action types and modes: `ACTIONS` in
`evaluation/runtime/lib/roles.ts`.

`evaluation/runtime/cases/clue-graph/mock-case/all-interactions.ts` is the coverage baseline: one case
per narrator interaction (`InteractionId` in `packages/shared/src/age-profile.ts`).

## Judges

- `flesch`, a check: the deterministic Flesch–Kincaid grade against the
  blueprint's `target_age`.
- `age_appropriate_turn`, a judge for what the formula cannot see (vocabulary,
  figurative language), against the narrator prompt's age profile.
- `gm_roleplay`, `gm_clue_discipline`, `gm_fabrication`, `gm_spoiler`: the
  adherence judges shared with the game harness (`evaluation/judges/README.md`).
  The history is context; only the action is judged.

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
`cases/clue-graph/mock-case/expect.ts`. `whole_fact` lists an expected
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

`./dev eval baseline save <run> <file>` retains a complete summary;
`baseline compare <baseline> <run>` prints changes. Clue-graph story folders
retain their model baselines.

## Frozen grounding experiment

`experiments/grounding/manifest.json` freezes the split, rubric, models, samples,
order, human review and thresholds; [baseline](experiments/grounding/baseline.json)
retains results. Raw artifacts stay under the output root. Held-out mysteries
stay sealed until candidate freeze; tuning retires them. Future runs exclude
OpenRouter; reviews use Codex GPT-6.1 at Medium effort.

CLI replay records
`output_role` and uses its normal parser; it measures **parsed role output**,
not every engine admissibility rule. Wrong reveals count as semantic failures;
parser failures retain calls/raw logs and never pass. Whole games measure
**engine-admitted play**, including rejected turns and incomplete games. Invalid,
rejected, transport and judge failures all remain in the denominator.
`evaluation/core/budget-proxy.ts` serialises requests, records requests/responses
and usage, reserves worst-case charges, and stops on unreconciled calls or limits.

## Running

```bash
# Plumbing, no model:
./dev eval judge turn evaluation/runtime/cases/clue-graph/mock-case/all-interactions.ts --narrator narrator-stub --judges flesch

# Graded cases, on one model:
./dev eval judge turn evaluation/runtime/cases/clue-graph/mock-case/expect.ts \
  --narrator narrator-claude --model-override narrator-claude=haiku

# The adherence judges:
./dev eval judge turn evaluation/runtime/cases/clue-graph/mock-case/readability.ts \
  --narrator narrator-claude --judges gm_roleplay,gm_clue_discipline,gm_fabrication,gm_spoiler
```

Each subject holds `turn.json` (captured before judging) and `result.json`.
Narrator failure exits 1; judge failure or error exits 2.

To re-judge a stored turn without calling its narrator:

```bash
./dev eval judge turn <run>/<case>__<narrator>/turn.json
```

Re-judging uses the adjacent result's judges, else `flesch`, or `--judges a,b`.
It uses default options; `judgeConfig` and `expect` are not stored.

### Cases from a played game

`./dev eval cases <trace.json>` exports supported events, their pre-state and
complete prior payloads, including notebook lines, use and commitments. It
retains targeted searches and accusation reasoning (`evaluation/trace/README.md`).

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
