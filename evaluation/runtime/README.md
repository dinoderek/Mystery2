# Runtime evaluation harness

Grades the runtime narrator — its prompts and the model behind them — one
interaction at a time: a case fixes the state and history, the harness collects
the narration for exactly one action, and judges score it. How this harness
fits beside the others is `docs/evaluation-pipeline.md`.

## Determinism is the point

A case evaluates **one action** against a **fully specified prior state**. The
complete conversation history is part of the case, not produced by playing
turns, so the model input is identical on every run and across models. If each
model saw its own earlier narration, models would diverge as turns accumulated
and stop being comparable.

## Choosing a backend

`--backend` decides who writes the narration under test:

| Backend | Narration comes from | Needs |
|---|---|---|
| `cli:claude`, `cli:openai` | a real model, called by the harness | that CLI on PATH (`OPENAI_API_KEY` for openai) |
| `endpoint --ai-profile free` (or `paid`) | a real model, called by the server | a running server and that profile's env file |
| `endpoint` | whatever the server's `default` profile resolves to | a running server |
| `cli:stub` | a canned shell script | nothing |

`endpoint` is the default, and its default profile is `default`, which the
server resolves from its environment, then the model chosen on the settings
page, then mock (`docs/ai-configuration.md`). Under plain `npm run dev` with
nothing chosen, a bare `run.mjs <cases>` grades the mock's canned text, not a
model.

The canned paths are fixtures: they prove the plumbing works offline, and
judging their content says nothing about the narrator. `cli:stub` is
blueprint-blind, so it cannot be in character for an arbitrary character and
`gm_roleplay` may rightly flag it. Keep stub runs to `flesch`.

To grade AI quality, use `cli:claude`: real prompt, real model, no server or
database. Use `endpoint` with a real profile when you also want the server in
the loop; it validates the model's clue reveals before they reach you, which the
CLI path does not. `--backend a,b` runs both on byte-identical input.

How each collects:

- **`endpoint`** seeds the fixed session and history into the database, calls
  the one `game-*` endpoint, then deletes the sessions it seeded. The server
  rebuilds the context from those rows, so the only variable is the model behind
  the session's `ai_profile`. `start` creates its own session, so nothing is
  seeded for it.
- **`cli:<variant>`** builds the prompt and context through
  `packages/game-engine/src/role-request.ts`, the module the server's handlers
  call, and pipes it to a local CLI. Assembly is shared, not reimplemented, so a
  replay and a live call cannot drift apart. Every action replays locally.

Two gotchas:

- **The database.** The endpoint backend resolves the database the way the
  server does, so in a worktree both use that worktree's. If you point the
  server elsewhere (`npm run prod`, or `--db`), export the matching
  `MYSTERY_DATABASE` for the harness too, or it seeds a database the server is
  not reading.
- **The `claude` wrapper** replaces Claude Code's system prompt and runs with no
  tools, MCP servers or settings, so the model under test does not also read
  this repo's `CLAUDE.md`. A login configured only in `settings.json`
  (`apiKeyHelper`, Bedrock or Vertex env) is skipped with them.

## Cases

A case is a blueprint, a `given` state (mode, location, time, the full
`history`), exactly one `action`, and the judges to run;
`evaluation/runtime/cases/age-readability.mjs` is an annotated example.
`history` rows have the shape the runtime stores in `game_events`, so the same
data drives both backends. The action types, and the mode each is valid from,
are `ACTIONS` in `evaluation/runtime/lib/roles.mjs`.

`evaluation/runtime/cases/all-interactions.mjs` is the coverage baseline: one
case per narrator interaction (`InteractionId` in
`packages/shared/src/age-profile.ts`), plus a targeted search. Every case passes
`flesch` on both fixture providers, so the suite is a clean green baseline and a
real failure stands out. That is why fixture narration is written at the target
reading age: the harness grades whatever the provider returns.

## Judges

- `flesch` — deterministic Flesch–Kincaid grade against the blueprint's
  `target_age`.
- `age_appropriate` — an LLM judge for what the formula can't see: vocabulary,
  figurative language, unclear phrasing, judged against the same age profile
  the narrator prompt was built from.
- `gm_roleplay`, `gm_clue_discipline`, `gm_fabrication`, `gm_spoiler` — the
  blueprint-adherence judges shared with the trace pipeline
  (`evaluation/judges/README.md`). Here the case's history is context and the
  action under test is the one judged turn. So a failure found in play can be
  frozen into a case with `cases-from-trace.mjs` and re-judged by the same
  standard against another model.

### Choosing and configuring judges

**Which run:** `--judges a,b`, else the case's `judges`, else none. No committed
case declares a `gm_*` judge, so the adherence battery is opt-in here, where the
trace pipeline runs all four on every trace.

**Per-case options** go in `judgeConfig.<judge>`: `tolerance` (`flesch`, grade
levels above target, default 2), `targetAge` (`flesch`, `age_appropriate`),
`blueprintPath` (`gm_*`), and `cli` for any LLM judge. Every LLM judge calls the
`judge` CLI variant unless `cli` is `judge-stub`, a deterministic stub that
always passes, for wiring checks. There is no flag for it.

### What a run costs

Model calls are cases × backends × LLM judges; `flesch` is free. On
`all-interactions.mjs` (10 cases, which declare `flesch` and `age_appropriate`):

| Command | Calls |
|---|---|
| no `--judges` | 10 — one `age_appropriate` per case |
| `--judges flesch` | 0 |
| `--judges gm_roleplay,gm_clue_discipline,gm_fabrication,gm_spoiler` | 40 |
| the same four, `--backend endpoint,cli:claude` | 80 |

That multiplier is why no case lists the adherence judges: it would take this
sweep from 10 calls to 50 for anyone who runs it without flags.

## Running

The `endpoint` backend needs the game running (`npm run dev`, or
`npm run dev:ai:free` for a live default); `MYSTERY_API_URL` points the harness
at a server on another port. The `cli:*` backends need nothing running.

```bash
# Plumbing, no model calls, no server:
node evaluation/runtime/run.mjs evaluation/runtime/cases/all-interactions.mjs --backend cli:stub --judges flesch

# Compare two model paths on identical input:
node evaluation/runtime/run.mjs evaluation/runtime/cases/age-readability.mjs --backend endpoint,cli:claude

# The adherence judges against a real model:
node evaluation/runtime/run.mjs evaluation/runtime/cases/age-readability.mjs \
  --backend cli:claude --judges gm_roleplay,gm_clue_discipline,gm_fabrication,gm_spoiler
```

Positionals are case files or directories of them. Besides `--backend`,
`--ai-profile` and `--judges`, `--out <dir>` moves the output root. Exit code is
`2` if any case errors or any judge fails or errors.

Each case × backend writes to
`evaluation/runtime/runs/<run_id>/<case>__<backend>/` (gitignored).
`interaction.json`, the raw capture, is written **before** any judge runs and is
the source of truth for re-judging; `result.json` holds the verdicts. A
run-level `summary.json` lists every result.

### Models

The CLI bindings are `evaluation/runtime/config/cli.example.json`; copy it to
`cli.json` beside it (gitignored) to change a model or wrapper permanently. For
one run, two env vars override them on the CLI paths (the `endpoint` backend's
model is the session's `ai_profile`):

- `RUNTIME_EVAL_MODEL` — the narrator model for `cli:*`.
- `RUNTIME_EVAL_JUDGE_MODEL` — the model for every LLM judge, independent of the
  narrator.

### Re-judging a stored interaction

The inner loop while iterating on judges; the narrator is never re-run:

```bash
node evaluation/runtime/rejudge.mjs evaluation/runtime/runs/<run_id>/<case>__<backend>/interaction.json
```

It runs the judges from the sibling `result.json` (else `flesch`), or
`--judges a,b`; `--case <file>` supplies that case's `judgeConfig`. It writes
`result.rejudge.json`, leaving `result.json` intact. LLM judges still call their
model.

### Cases from a played trace

`cases-from-trace.mjs` turns a trace from `evaluation/trace/extract.mjs` into a
case file. Each event's payload records the state it was generated from, so a
chosen event becomes one case: the pre-event state plus every earlier event as
`given`, the event as `action`. The trace's blueprint is written beside it.

```bash
node evaluation/runtime/cases-from-trace.mjs <trace.json>
```

By default it samples up to 3 `ask` and 3 `talk` events evenly across the
session, judged by `flesch`, into `evaluation/runtime/cases/from-traces/`
(gitignored); `--types`, `--max`, `--judges` and `--out` change those.

## Adding things

- **A case** — a file under `evaluation/runtime/cases/`, on a blueprint with the
  `target_age` (or other property) you need.
- **A judge** — `evaluation/runtime/lib/judges/<id>.mjs`, registered in its
  `index.mjs`. One that grades narration against the blueprint belongs in the
  shared layer instead, so it also runs on traces
  (`evaluation/judges/README.md` → "Adding a judge").
- **An action** — an entry in `ACTIONS`: its endpoint, a `roleInput` naming the
  role and passing the fields the handler passes, and a `speaker`. Prompt
  assembly belongs in `packages/game-engine/src/role-request.ts`, defined once
  for the handler and this harness.

## Tests

Unit tests under `tests/api/unit/` (the `runtime-*` and `judges-*` files) cover
the judges, action mapping and case generation. They run with
`npm run test:unit`, and none calls a model.
