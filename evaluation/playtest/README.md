# Playtest harness

Plays whole games of Mystery2 with an **AI investigator** against the real game
server, so the narrator can be judged over a full case rather than one turn at a
time. Each game leaves a readable transcript, the investigator's inputs as a
script for [replay](#replay), and every step and narrator call behind it. How
this harness fits beside the others is in `docs/evaluation-pipeline.md`.

## Quick start

```bash
npm run eval:playtest -- --blueprint the-missing-heartwood
npm run eval:playtest -- --blueprint the-missing-heartwood --persona kid-7 --games 3
npm run eval:playtest -- --replay evaluation/playtest/runs/<run>/game-1/script.json
npm run eval:playtest -- --blueprint the-missing-heartwood --judge
npm run eval:playtest:report -- evaluation/playtest/runs/<run>
```

Needs a logged-in `claude` CLI (both the narrator and the investigator run
through it) and nothing else: no API key, no env file. It builds the web app,
starts it on a free port against a throwaway database, and never touches yours.
Run it with `--help` for the full option list; `--narrator mock` is for
plumbing checks only. Open `evaluation/playtest/runs/<run>/report.html`, or
read one game's `game-<n>/transcript.md`.

## How a turn works

- **The runner makes no choices.** Every input comes from the investigator
  after it reads the latest narration. The one step it takes itself is the
  browser's: after `game-start` narrates the premise, `game-enter` (the
  player's "press any key") narrates the arrival.
- **The investigator sees what a player sees, and no more.** The view is built
  from the session state the API returns to the browser, with the web app's own
  notebook helpers (`web/src/lib/domain/notebook.ts`), never from the
  blueprint.
- **Input is handled as the browser handles it.** The line goes through the
  UI's parser (`web/src/lib/domain/parser.ts`); a line it rejects gets the UI's
  hint and costs no turn. Routing (`lib/commands.mjs`) mirrors
  `getBackendInvocation` in `web/src/lib/domain/store.svelte.ts`, and failed
  calls are retried by the store's own rule
  (`web/src/lib/domain/store.retry.ts`). Keep the two in step.
- **No hidden memory.** Each investigator call gets the whole view and history,
  so any step can be read back from `steps.jsonl`.

A game stops when the case ends, the investigator quits or fails, three calls
in a row fail, `--max-steps` runs out, or a replay runs out of script or
diverges. Its folder is written either way, with `stop_reason` in
`summary.json`. Narrator calls are capped at 90 seconds so a slow turn fails as
a turn rather than outlasting the request.

## A run folder

`runs/<timestamp>-<blueprint>-<persona>/` (gitignored) keeps the throwaway
`game.db` and every narrator call the server made. Each `game-<n>/` holds the
`transcript.md` (with the investigator's plan in italics), the `script.json`
to replay, `steps.jsonl`, and a `summary.json` of outcome, stop reason, clues
found and costs.

`report.html` puts every game on one page that opens from disk: the verdicts
side by side, then each game turn by turn, with every judge finding beside the
turn it cites, the clues each turn recorded and each narration's reading level.
Its turns come from `game.db`, numbered as the judges cite them, and each
input and plan is matched from `steps.jsonl` by the narration it got back; a
line the parser rejected shows where it was typed. The run writes it last.
`eval:playtest:report` rebuilds it, for a run graded by hand afterwards.

## Replay

`--replay <script.json>` types a recorded game's inputs again, with no
investigator calls. Set a change up (an edited prompt, another
`--narrator-model`), replay, and read the two transcripts side by side.
Replaying one script with `--games 3` shows how much the narration varies on
its own.

Narration varies, so a replay can reach a point where an input no longer means
what it did. Each input is saved with a checkpoint of the game just before it
was typed, and the replay compares it with the live game. If the mode, place,
talk partner or people there differ, or the game ends with script left, the
replay stops as `diverged` and records what differed. If only the clues differ
(one came a turn earlier or later), it carries on and records the first such
step as `clue_drift`. A script without checkpoints replays with a warning and
no checks.

## Grading

Off by default: the transcript is written to be read. With `--judge`, each game
is graded as soon as it ends, while the next ones play, by running the trace
pipeline (`evaluation/trace/README.md`) unchanged on a copy of the database
taken then:

```bash
npm run eval:trace:extract -- --db <copy> --session <game_id> --out <game>/trace.json
npm run eval:trace -- --trace <game>/trace.json --output-root <game>/judge
```

That gives the mechanical checks and the four `gm_*` judges, one Opus call
each. Games are graded one at a time, so at most four judge calls run at once.
Every narration is then scored with the runtime harness's `flesch` judge
(`evaluation/runtime/lib/judges/flesch.mjs`, no model call) against the
blueprint's `target_age`.

The verdicts go into the game's `summary.json` and the foot of its transcript;
a game that cannot be graded says why there. The judges need
`evaluation/trace/config/cli.json`:

```bash
cp evaluation/trace/config/cli.example.json evaluation/trace/config/cli.json
```

Without it `--judge` stops before playing, rather than grading with the
mechanical checks alone. A game from an earlier run is graded by hand with the
same two commands, run on `<run>/game.db`; then rebuild its report.

## Personas

`personas/*.md`, spliced into `prompts/investigator.md`. `detective` explores
methodically and accuses with evidence; `kid-7` types short, misspelled lines
and wanders off topic, which exercises the narrator's handling of input it
cannot understand. Add a persona by adding a file.

## Safeguard refusals

Keep prompts and schemas from asking a model to report its reasoning. The
investigator's reply carries a `plan` field, a note for the log. Named
`thinking` and asking for "what you are doing next and why", it read to the
API's safeguards as reasoning extraction (`Details: [reasoning_extraction]` in
the refusal) and was refused about three turns in eight, on Sonnet and Opus
alike; as `plan`, 8 of 8 went through on the same view.

A refusal that still happens is retried twice; after that the game stops with
`stop_reason: investigator-error` and the folder records what was played. The
narrator can be refused the same way; that fails the turn, and the transcript
shows the error.

## Cost

Every turn is a narrator call and an investigator call, and the investigator's
input grows with the story. `summary.json` reports both costs per game; check
the first run's figure before playing many games.

## Tests

`tests/api/unit/playtest-*.test.ts` and
`tests/api/integration/playtest*.test.ts`. The integration tests play, replay,
grade and report a mock game end to end with a scripted investigator and a stub
judge; no model is called.
