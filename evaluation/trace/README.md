# Game-master trace evaluation pipeline

Judges how well the AI **game master** played a mystery, with a played *trace*
as the subject instead of a generated blueprint. How it shares machinery with
the blueprint pipeline and the runtime harness is in
`docs/evaluation-pipeline.md`; the four `gm_*` judges it runs are owned by
`evaluation/judges/README.md`.

## Why this exists

The game already persists every played session for resume: a `game_sessions`
snapshot plus an append-only `game_events` log. That is a complete trace of
what the game master did. This pipeline turns it into a quality signal (where
did the game master fabricate, leak the solution, or mishandle clues) and a
durable artifact to re-run when you switch models or change a prompt.

## The two stages

```
extract.mjs        run.mjs
  game.db  ──►  raw trace JSON  ──►  reconstruct  ──►  checks + judges  ──►  result.json
```

1. **Extract** pulls a session out of `game.db` (snapshot, ordered events, the
   blueprint, non-secret AI-profile metadata) into a **raw** trace: a faithful
   dump with no derived fields.
2. **Run** takes a raw trace, **reconstructs** what the game master saw each
   turn by replaying the events through the real context builders
   (`packages/game-engine/src/ai-context.ts`), then runs the mechanical checks
   and the judges.

Reconstruction happens at run time, not in the stored artifact, so it stays
versioned with the code instead of frozen into old data. Traces carry no
context version: the builders are not versioned, and a stamp could not
reproduce a historical prompt anyway. A re-run always reflects the current
game-master logic, and the raw trace keeps a re-run possible.

## Running it

```bash
# Optional: bind a CLI for the judges. Without it, only the mechanical checks run.
cp evaluation/trace/config/cli.example.json evaluation/trace/config/cli.json

npm run eval:trace:extract -- --session <session-id> --out trace.json
npm run eval:trace -- --trace trace.json

# Or extract and evaluate in one step:
npm run eval:trace -- --session <session-id>
```

Both commands take `--help`. Extraction reads the database file directly, so
the game need not be running; which database it reads is in
`docs/local-infrastructure.md`. Each run writes a self-contained directory
under `$MYSTERYEVALS_DIR` (default `~/mysteryevals`) with `result.json`,
`reconstruction.json` and per-judge logs. Progress reporting works as in the
blueprint pipeline (`evaluation/README.md` → "Live progress").

**The exit code is not the verdict.** The process exits non-zero only when the
run itself fails (an extraction error, say). A failing check or judge still
exits 0, so a CI caller gates on `summary.mechanical.fail` and
`summary.dimensions.fail` in `result.json`.

## The judge wrapper

`config/wrappers/claude-trace-judge.sh` calls `claude` with `--system-prompt`
(replacing Claude Code's own) and no tools, MCP servers or settings, so neither
that prompt nor the repo's `CLAUDE.md` reaches the judge; the CLI still adds a
short environment note. Two consequences:

- **Settings-only logins fail.** Skipping settings also skips a login set only
  in `settings.json` (`apiKeyHelper`, Bedrock or Vertex env), so the wrapper
  cannot authenticate.
- **Fenced verdicts are unwrapped.** Judges sometimes wrap the verdict in a
  `json` code fence, which the pipeline would reject as "not a JSON object";
  the wrapper strips it.

## Checks and dimensions

The mechanical checks live in `lib/mechanical.mjs`; the first two run on every
trace:

| Check | Asks |
|---|---|
| `clue_accounting` | Every revealed clue id is real and in scope, with no repeats. Each bare search reveals the next unrevealed location clue that is *unlocked* (its `requires` already revealed), skipping locked ones. |
| `spoiler_leak` | No pre-accusation narration copies a long *verbatim* run of ground-truth text. Verbatim only, so it stays precise; paraphrase is `gm_spoiler`'s job. |
| `clue_requires_violation` | No `requires`-gated clue is revealed before its prerequisites, unless the event lists it in `revealed_off_script`. **Off by default**: set `enforce_requires: true` in `mechanical_context` in `dimensions/registry.json`. |

The judges are listed in `dimensions/registry.json`: today the four shared
`gm_*` judges, one model call each, run in parallel. A dimension id is looked
up in `evaluation/judges/` first, then in `dimensions/`, so a trace-only
dimension is a brief and a schema dropped in there, named as in
`evaluation/judges/README.md` → "Adding a judge", and added to the registry.

To re-judge a single turn against another model or prompt, turn the trace into
runtime cases with `npm run eval:cases-from-trace` (`evaluation/runtime/README.md`).

## Tests

`tests/api/unit/trace-*.test.ts` cover normalisation, reconstruction, the
checks, the envelope and a run with a mock judge CLI. They need no database
and no model.

## Not built yet

- More judges: search adjudication, accusation correctness, tone.
- Extracting a batch of sessions at once, and run history beyond the run
  directories.
