# Game-master trace evaluation

Judges how well the AI **game master** played a mystery, with a played *trace* as
the subject instead of a generated blueprint. The design is in
`docs/evaluation-pipeline.md`; the four `gm_*` judges it runs are owned by
`evaluation/judges/README.md`.

The game keeps every played session in `game_sessions` and an append-only
`game_events` log. This pipeline turns that log into a quality signal.

1. **Extract** pulls a session from `game.db` (snapshot, ordered events, the
   blueprint, non-secret AI-profile metadata) into a **raw** trace with no derived
   fields. `lib/datasource.ts` is the one module that resolves the play database
   path, and it opens the file read-only, with no migration run.
2. **Judge** reconstructs what the game master saw each turn, by replaying the
   events through the real context builders (`packages/game-engine/src/ai-context.ts`),
   then runs the checks and judges.

Reconstruction happens at run time, not in the stored trace, so a re-run always
reflects the current game-master logic. Traces carry no context version: the
builders are not versioned, and a stamp could not reproduce an old prompt anyway.

## Running it

```bash
./dev eval judge game <session-id>                       # extract, then judge
./dev eval judge game <run>/<session-id>/trace.json      # judge a stored trace again
```

The argument is a trace file if it names one, else a session id. A path or `.json`
name that is no file is an error, never a session id. `--database <file>` reads
the session from a copy of `game.db` instead of this checkout's play database
(`docs/local-infrastructure.md`); the game need not be running. The subject folder
adds `trace.json` and `reconstruction.json` (turns and context errors) to the
usual layout in `evaluation/README.md`.

## The judge wrapper

`config/wrappers/claude-trace-judge.sh` calls `claude` with `--system-prompt`
(replacing Claude Code's own) and no tools, MCP servers or settings. Neither that
prompt nor the repo's `CLAUDE.md` reaches the judge; the CLI still adds a short
environment note. Two consequences:

- **Settings-only logins fail.** Skipping settings also skips a login set only in
  `settings.json` (`apiKeyHelper`, Bedrock or Vertex env), so the wrapper cannot
  authenticate.
- **Fenced verdicts are unwrapped.** Judges sometimes fence the verdict in `json`,
  which the runner would reject as not JSON; the wrapper strips the fence.

## Checks

The mechanical checks live in `lib/mechanical.ts`. The first two run on every
trace:

| Check | Asks |
|---|---|
| `clue_accounting` | Every revealed clue id is real and in scope, with no repeats. Each bare search reveals the next unrevealed location clue that is *unlocked* (its `requires` already revealed), skipping locked ones. |
| `spoiler_leak` | No pre-accusation narration copies a long *verbatim* run of ground-truth text. Verbatim only, so it stays precise; paraphrase is `gm_spoiler`'s job. |
| `clue_requires_violation` | No `requires`-gated clue is revealed before its prerequisites, unless the event lists it in `revealed_off_script`. **Off by default**: set `enforce_requires: true` on its entry in `evaluation/core/registry.ts`. |

The judges are the registry's `game` judges: today the four shared `gm_*` judges,
one model call each, run in parallel. To re-judge a single turn against another
model or prompt, turn the trace into runtime cases with `./dev eval cases`
(`evaluation/runtime/README.md`).

## Tests

`tests/api/unit/trace-*.test.ts` cover normalisation, reconstruction, the checks,
read-only extraction from a database the test makes, and a whole `judge game` run
on a stub binding. They need no model.

## Not built yet

- More judges: search adjudication, accusation correctness, tone.
- Extracting a batch of sessions at once, and run history beyond the run folders.
