# Game-master trace evaluation pipeline

Judges how well the AI **game master** played a mystery, with a played *trace*
as the subject instead of a generated blueprint. How it shares machinery with
the blueprint pipeline and the runtime harness is in
`docs/evaluation-pipeline.md`; the four `gm_*` judges it runs are owned by
`evaluation/judges/README.md`.

## Why this exists

The game persists every played session for resume: a `game_sessions` snapshot
plus an append-only `game_events` log, a complete trace of what the game master
did. This pipeline turns it into a quality signal (where did the game master
fabricate, leak the solution, or mishandle clues) and a durable artifact to
re-run when you switch models or change a prompt.

## The two stages

```
game.db  ──►  trace.json  ──►  reconstruct  ──►  checks + judges  ──►  result.json
 (read-only)
```

1. **Extract** pulls a session out of `game.db` (snapshot, ordered events, the
   blueprint, non-secret AI-profile metadata) into a **raw** trace: a faithful
   dump with no derived fields. `lib/datasource.ts` is the one evaluation
   module that resolves the play database path, and it opens the file
   read-only: nothing is created, no schema applied, no migration run, so a
   database from another branch's schema is read as it is.
2. **Judge** **reconstructs** what the game master saw each turn by replaying
   the events through the real context builders
   (`packages/game-engine/src/ai-context.ts`), then runs the mechanical checks
   and the judges.

The log also holds `no_turn_line` events (a refused line, `help`); extraction
and every reader skip them.

Reconstruction happens at run time, not in the stored artifact, so it stays
versioned with the code instead of frozen into old data. Traces carry no
context version: the builders are not versioned, and a stamp could not
reproduce a historical prompt anyway. A re-run always reflects the current
game-master logic, and the raw trace keeps a re-run possible.

## Running it

```bash
./dev eval judge game <session-id>            # extract, then judge
./dev eval judge game <run>/<session-id>/trace.json   # judge a stored trace again
```

The argument is a trace file if it names one, else a session id; a path or
`.json` name that is no file is an error, never a session id. `--database
<file>` reads the session from a copy of `game.db` instead of this checkout's
play database (`docs/local-infrastructure.md`); the game need not be running.
`--no-judges` runs the checks alone and `--judges a,b` only those judges; the
rest are `skipped`. A missing `game-judge` binding is an error. The run folder,
`result.json`, bindings and exit codes are in `evaluation/README.md`; the
subject folder adds `trace.json` and `reconstruction.json` (turns, context errors).

## The judge wrapper

`config/wrappers/claude-trace-judge.sh` calls `claude` with `--system-prompt`
(replacing Claude Code's own) and no tools, MCP servers or settings, so neither
that prompt nor the repo's `CLAUDE.md` reaches the judge; the CLI still adds a
short environment note. Two consequences:

- **Settings-only logins fail.** Skipping settings also skips a login set only
  in `settings.json` (`apiKeyHelper`, Bedrock or Vertex env), so the wrapper
  cannot authenticate.
- **Fenced verdicts are unwrapped.** Judges sometimes fence the verdict in
  `json`, which the runner would reject as not JSON; the wrapper strips it.

## Checks and dimensions

The mechanical checks live in `lib/mechanical.ts`; the first two run on every
trace:

| Check | Asks |
|---|---|
| `clue_accounting` | Every revealed clue id is real and in scope, with no repeats. Each bare search reveals the next unrevealed location clue that is *unlocked* (its `requires` already revealed), skipping locked ones. |
| `spoiler_leak` | No pre-accusation narration copies a long *verbatim* run of ground-truth text. Verbatim only, so it stays precise; paraphrase is `gm_spoiler`'s job. |
| `clue_requires_violation` | No `requires`-gated clue is revealed before its prerequisites, unless the event lists it in `revealed_off_script`. **Off by default**: set `enforce_requires: true` on its entry in `evaluation/core/registry.ts`. |

The judges are the registry's `game` judges: today the four shared `gm_*`
judges, one model call each, run in parallel. A trace-only dimension is a brief
and a schema named as in `evaluation/judges/README.md` → "Adding a judge", with
the subject kind `game`.

To re-judge a single turn against another model or prompt, turn the trace into
runtime cases with `npm run eval:cases-from-trace` (`evaluation/runtime/README.md`).

## Tests

`tests/api/unit/trace-*.test.ts` cover normalisation, reconstruction, the
checks, read-only extraction from a database the test makes, and a whole
`judge game` run on a stub binding. They need no model.

## Not built yet

- More judges: search adjudication, accusation correctness, tone.
- Extracting a batch of sessions at once, and run history beyond the run
  directories.
