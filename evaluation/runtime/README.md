# Judging a turn

Grades the runtime narrator, its prompts and the model behind them, one
interaction at a time: a case fixes the state and history, the harness collects
the narration for exactly one action, and checks and judges score it. The
commands are `./dev eval judge turn` and `./dev eval cases`; the config file,
`result.json`, run folders and exit codes are in `evaluation/README.md`, and how
this harness fits beside the others is `docs/evaluation-pipeline.md`.

## Determinism is the point

A case evaluates **one action** against a **fully specified prior state**. The
complete conversation history is part of the case, not produced by playing
turns, so the model input is identical on every run and across models. Models fed
their own earlier narration would diverge past comparison.

## Choosing a narrator

`--narrator` decides who writes the narration under test. It takes a list, which
runs every case once per narrator on byte-identical input.

| Narrator | Narration comes from | Needs |
|---|---|---|
| `narrator-claude`, `narrator-openai` | a real model, called by the harness | that CLI on PATH (`OPENAI_API_KEY` for openai) |
| `server` (the default) | the game, on a throwaway server | a build; `--ai-profile` names the profile |
| `narrator-stub` | a canned shell script | nothing |

To grade a model, use `narrator-claude`: real prompt, real model, no server and
no database. Change its model for one run with `--model-override
narrator-claude=<model>`. Use `server` when you also want the game in the loop;
it validates the model's clue reveals before they reach you, which the CLI path
does not.

The canned narrator is a fixture: it proves the plumbing offline, and judging its
content says nothing about the narrator. It is blueprint-blind, so it cannot be
in character for an arbitrary character and `gm_roleplay` may rightly flag it.
Keep stub runs to `flesch`.

`narrator-claude` replaces Claude Code's system prompt and runs with no tools, MCP
servers or settings, so the model under test does not also read this repo's
`CLAUDE.md`. A login configured only in `settings.json` (`apiKeyHelper`, Bedrock
or Vertex env) is skipped with them.

### The throwaway server

A `server` run builds the app once and starts it on a free port against a
temporary config root (`scripts/lib/test-server.mjs`, as self-play does). It
seeds each case's session and history into that root's database, sends the action
to `game-turn` as the line a player would type (`move to <place>`, `talk to
<name>`, `search <query>`, `bye`, a question, `accuse [<reasoning>]`, then the
reasoning alone once the accusation is open), and removes the root afterwards.
`start` creates its own session, so nothing is seeded for it. Nothing writes to
the database you play on, and there is no way to point the harness at a server
you started yourself. A case that sets `accusation_history_mode` needs a CLI
narrator: a typed line cannot carry it.

The server resolves the profile as it always does. `mock` needs nothing. `default`
is whatever the environment names (`AI_PROVIDER` and `AI_MODEL`), else mock, so a
bare run grades the mock's canned text. `free` and `paid` are linked in from your
config root for the run, so the key stays in its own file.

## Cases

A case is a blueprint, a `given` state (mode, location, time, the full
`history`), exactly one `action`, and the judges to run. A case file is a `.ts`,
`.mjs` or `.json` file holding one case or a list; a folder is every case file in
it. `evaluation/runtime/cases/age-readability.ts` is an annotated example. `history`
rows have the shape the runtime stores in `game_events`, so the same data seeds the
server and feeds the context builder. The action types, and the mode each is valid
from, are `ACTIONS` in `evaluation/runtime/lib/roles.ts`.

`evaluation/runtime/cases/all-interactions.ts` is the coverage baseline: one case
per narrator interaction (`InteractionId` in `packages/shared/src/age-profile.ts`),
plus a targeted search. Every case passes `flesch` on both fixture narrators, so
the suite is a clean green baseline and a real failure stands out.

## Judges

- `flesch`, a check: deterministic Flesch–Kincaid grade against the blueprint's
  `target_age`.
- `age_appropriate_turn`, a judge for what the formula can't see: vocabulary,
  figurative language, unclear phrasing, against the same age profile the
  narrator prompt was built from. It is not the blueprint dimension
  `age_appropriate`.
- `gm_roleplay`, `gm_clue_discipline`, `gm_fabrication`, `gm_spoiler`, the
  adherence judges shared with the game harness (`evaluation/judges/README.md`).
  Here the case's history is context and the action under test is the one judged
  turn. A failure found in play can be frozen into a case with `cases` and
  judged by the same standard against another model.

**Which run:** `--judges a,b`, else the case's `judges`, else none (a stored turn:
the judges of the result beside it, else `flesch`). No committed case declares a
`gm_*` judge, so the battery is opt-in here, where the game harness runs all four.

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

Each case × narrator is one subject, `<case>__<narrator>/`, with `turn.json`, the
raw capture, written **before** any judge runs, and `result.json`. A narrator that
fails leaves a `result.json` with a run error and exits 1; a judge that fails or
cannot judge exits 2.

### Judging a stored turn again

The inner loop while iterating on judges; the narrator is never called, so the
config needs no narrator binding:

```bash
./dev eval judge turn <run>/<case>__<narrator>/turn.json
```

It runs the judges of the `result.json` beside it, else `flesch`, or `--judges
a,b`, and writes a new run. Model judges still call their model.

### Cases from a played game

`./dev eval cases <trace.json>` turns a trace from the trace extractor (`evaluation/trace/README.md`) into cases. Each
event's payload records the state it was generated from, so a chosen event becomes
one case: the pre-event state plus every earlier event as `given`, the event as
`action`. The trace's blueprint is written beside them. It samples up to 3 `ask`
and 3 `talk` events evenly across the session, judged by `flesch`, into
`<output root>/cases/<trace>/`; `--types`, `--max`, `--judges` and `--out` change
those.

## Adding things

- **A case**: a file under `evaluation/runtime/cases/`, on a blueprint with the
  `target_age` (or other property) you need.
- **A judge**: a registry entry (`evaluation/judges/README.md`, "Adding a judge")
  that lists `turn` among its subjects.
- **An action**: an entry in `ACTIONS`: the `line` that plays it, a `roleInput`
  naming the role and passing the fields the handler passes, and a `speaker`.
  Prompt assembly belongs in `packages/game-engine/src/role-request.ts`, defined
  once for the handler and this harness.

## Tests

Unit tests under `tests/api/unit/` (the `runtime-*` and `judges-*` files) cover the
judges, action mapping, case generation and a whole `judge turn` run on stub
bindings; `tests/api/integration/eval-turn-server.test.ts` replays through a real
throwaway server on the mock provider. None calls a model.
