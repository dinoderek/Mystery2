# Playtest harness

Plays whole games of Mystery2 with an **AI investigator** against the real game
server, so the narrator can be judged over a full case rather than one turn at a
time. Each game leaves a readable transcript, its inputs as a script for
[replay](#replay), and every step behind it. How this harness fits beside the
others is in `docs/evaluation-pipeline.md`.

## Quick start

```bash
./dev eval play --blueprint the-missing-heartwood
./dev eval play --blueprint the-missing-heartwood --persona kid-7 --games 3
./dev eval play --replay <run>/<game>/script.json
./dev eval play --blueprint the-missing-heartwood --judge
./dev eval report <run>
```

Needs a logged-in `claude` CLI (the narrator and the investigator both run
through it) and no API key. It builds the web app, starts it on a free port
against a throwaway database, and never touches yours. `--help` lists the
options; `--narrator mock` is for plumbing checks only. Runs sit under the
output root (`evaluation/README.md`): open `<run>/report.html`, or read a
game's `transcript.md`.

The investigator is the `investigator` binding (`evaluation/config.example.json`).
Its wrapper, `wrappers/claude-investigator.sh`, runs the CLI isolated from the
repo with the reply schema; `--model-override investigator=<model>` picks
another model. Exit 0 when every game ran and passed, 1 when a game could not
be played, 2 when a judge failed a game.

## How a turn works

- **The runner makes no choices.** Every input comes from the investigator. The
  one step it takes itself is the browser's: after `game-start` narrates the
  premise, `game-enter` (the "press any key") narrates the arrival.
- **The investigator sees what a player sees, and no more.** The view is built
  from the session state the API returns to the browser, with the web app's own
  notebook helpers (`web/src/lib/domain/notebook.ts`), never from the
  blueprint.
- **The engine reads every line.** The line is posted as typed to `game-turn`,
  which answers one of four kinds: `turn` (played, one turn spent), `refused`
  (its hint, no turn), `view` (help or the notebook, no turn; the investigator
  is told in a line) or `quit`. No UI parser is imported; failed calls are
  retried by the web store's own rule (`web/src/lib/domain/store.retry.ts`).
- **No hidden memory.** Each call gets the whole view and history, so any step
  can be read back from `steps.jsonl`.

A game stops when the case ends, the investigator quits or fails, three calls
in a row fail, `--max-steps` runs out, or a replay runs out of script or
diverges. Its folder is written either way, with `stop_reason` in
`summary.json`. Narrator calls are capped at 90 seconds, so a slow turn fails
as a turn.

## A run folder

Each game is a subject of the run, in a folder named after its game id (`game-<n>`
if it could not start). Its `result.json` holds the investigator's model calls
and, when graded, the verdicts. Beside it: `transcript.md` (the investigator's
plan in italics), `script.json` to replay, `steps.jsonl`, `events.json`, a
`summary.json` of outcome, stop reason, clues and costs, and `logs/`. The run
keeps the throwaway `game.db` and every narrator call the server made.

`report.html` puts every game on one page that opens from disk: the verdicts
side by side, then each game turn by turn, with every judge finding beside the
turn it cites, the clues recorded and each narration's reading level. Turns
come from `events.json`, numbered as the judges cite them; each input and plan
is matched from `steps.jsonl` by the narration it got back, and a line that
played nothing shows where it was typed. `play` writes it last; `report`
rebuilds it, for a run graded by hand afterwards.

## Replay

`--replay <script.json>` types a recorded game's inputs again, with no
investigator calls. Change something (an edited prompt, another
`--narrator-model`), replay, and read the transcripts side by side. Replaying
one script with `--games 3` shows how much the narration varies on its own.

Narration varies, so an input may no longer mean what it did. Each input is
saved with a checkpoint of the game just before it was typed, and the replay
compares it with the live game. If the mode, place,
talk partner or people there differ, or the game ends with script left, the
replay stops as `diverged` and records what differed. If only the clues differ
(one came a turn earlier or later), it carries on and records the first such
step as `clue_drift`. A script without checkpoints replays with a warning and
no checks.

## Grading

Off by default. With `--judge`, each game is graded as soon as it ends, while
the next ones play, by running the game command (`evaluation/trace/README.md`)
on a trace extracted, read-only, from a copy of the database taken then:

```bash
./dev eval judge game <trace.json> --output-root <game>/judge
```

That gives the mechanical checks and the four `gm_*` judges, one Opus call
each. Games are graded one at a time, so at most four judge calls run at once.
Every narration is then scored with the runtime harness's `flesch` check
(`evaluation/runtime/lib/flesch.ts`, no model call) against the
blueprint's `target_age`.

The verdicts go into the game's `result.json`, `summary.json` and transcript;
a game that cannot be graded says why there. The game command exits 2 when a
judge fails a game, which is a finding, not a broken run. Without the
`game-judge` binding `--judge` stops before playing. A game from an earlier run
is graded by hand with `judge game <game id> --database <run>/game.db`; then
rebuild the report.

## Personas

`personas/*.md`, spliced into `prompts/investigator.md`. `detective` explores
methodically and accuses with evidence; `kid-7` types short, misspelled lines
and wanders off topic, which exercises the narrator's handling of input it
cannot understand. Add a file to add a persona.

## Safeguard refusals

Keep prompts and schemas from asking a model to report its reasoning. The
reply's `plan` field is a note for the log. Named `thinking` and asking for
"what you are doing next and why", it read to the API's safeguards as reasoning
extraction (`Details: [reasoning_extraction]`) and was refused about three
turns in eight, on Sonnet and Opus alike; as `plan`, 8 of 8 went through.

A refusal that still happens is retried twice, by the binding; then the game
stops with `stop_reason: investigator-error`, and its `result.json` says the
run broke. The narrator can be refused the same way; that fails the turn.

## Cost

Every turn is a narrator call and an investigator call, whose input grows with
the story. `summary.json` reports both costs per game; check the first run's
figure before playing many games.

## Tests

`tests/api/unit/playtest-*.test.ts` and
`tests/api/integration/playtest*.test.ts`: a mock game played, replayed,
graded and reported with a stub investigator and judge, so no model is called.
The investigator's CLI arguments are compared with the snapshot
(`docs/testing.md`).
