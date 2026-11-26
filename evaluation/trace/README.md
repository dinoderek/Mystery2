# Game-master trace evaluation

Judges how well the AI **game master** played a mystery, with a played *trace* as
the subject instead of a generated blueprint. The design is in
`docs/evaluation-pipeline.md`; the four `gm_*` judges it runs are owned by
`evaluation/judges/README.md`.

The game keeps every session in `game_sessions` and an append-only `game_events`
log. This pipeline turns that log into a quality signal.

1. **Extract** pulls a session from `game.db` (snapshot, ordered events, the
   case, the model its events carry) into a **raw** trace with no derived
   fields. The case is the game's saved clue-graph snapshot ([`docs/clue-graph.md`](../../docs/clue-graph.md)); the trace adds `clue_graph`: format, revision, progress. Each turn is judged at the `reading_age` its event records; a trace without one, or a game with no clue-graph snapshot, is refused by name. `lib/datasource.ts` resolves the play database path and opens it read-only.
2. **Judge** reconstructs what the game master saw each turn, by replaying the
   events through the real context builders (`packages/game-engine/src/ai-context.ts`),
   then runs the checks and judges.

Reconstruction happens at run time, not in the stored trace, so a re-run reflects
the current game-master logic. Traces carry no context version: the builders are
not versioned.

## Running it

```bash
./dev eval judge game <session-id>                  # extract, then judge
./dev eval judge game <run>/<session-id>/trace.json # judge a stored trace again
./dev eval judge game <id> <id> ...                 # a batch
./dev eval judge game --bundle <folder>             # every game in a playtest bundle
./dev eval judge game --since <date> --database <name|file>  # every game from a date
```

The argument is a trace file if it names one, else a session id; a path or `.json`
name that is no file is an error. `--database <file>` reads a copy of `game.db`
instead of the play database (`docs/local-infrastructure.md`). The subject folder
adds `trace.json` and `reconstruction.json` to `evaluation/README.md`'s layout.

A batch writes one parent run with a subject per game, as `play --judge` does, and
a child run per game in its `judge/` folder: the run one game writes, with the
parent as `parent_run`. `--bundle` reads `<folder>/game.db` and `ai-calls.jsonl`;
`--since` takes the games `./dev sessions` lists. Neither combines with ids or each
other. A game's calls, joined to its events by `request_id`, are its `production`
and its `ai-calls.jsonl`. One game's error stops no other; no games exits 1.
`--concurrency <n>` (default 2) sets games judged at once.

## The judge wrapper

`config/wrappers/claude-trace-judge.sh` calls `claude` with `--system-prompt` and no
tools, MCP servers or settings, so neither Claude Code's prompt nor the repo's
`CLAUDE.md` reaches the judge. Two consequences:

- **Settings-only logins fail.** A login set only in `settings.json`
  (`apiKeyHelper`, Bedrock or Vertex env) is skipped too.
- **Fenced verdicts are unwrapped.** A fenced `json` verdict, which the runner
  would reject, has its fence stripped.

## Checks

`lib/mechanical.ts` holds both mechanical checks, run on every trace:

| Check | Asks |
|---|---|
| `clue_accounting` | The events folded by the engine's rules: every revealed clue is real, comes once and was on offer, and nothing the narrator reported was refused. |
| `spoiler_leak` | No narration before the closing scene copies a long *verbatim* run of ground truth. Verbatim only, to stay precise; paraphrase is `gm_spoiler`'s. |

The judges are the registry's `game` judges: today the four shared `gm_*` judges,
one model call each, in parallel. To re-judge a turn against another model or
prompt, turn the trace into runtime cases with `./dev eval cases`
(`evaluation/runtime/README.md`).

## Tests

`tests/api/unit/trace-*.test.ts` run on a stub binding and need no model.

## Not built yet

- More judges: search adjudication, accusation correctness, tone.
- Run history beyond the run folders.
