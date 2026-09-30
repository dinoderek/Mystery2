# Playtest harness

Plays whole games of Mystery2 with an **AI investigator** against the real game
server, so the narrator can be judged over a full case rather than one turn at a
time. Each game leaves a readable transcript, the investigator's inputs as a
script (for replaying against a changed narrator with `--replay`), and every
step and narrator call behind it.

This is the fourth harness, beside the blueprint pipeline (`evaluation/`), the
game-master trace pipeline (`evaluation/trace/`) and the runtime narrator harness
(`evaluation/runtime/`). Those grade a blueprint, a finished session, or one
narrator turn; this one produces the sessions.

## Quick start

```bash
npm run eval:playtest -- --blueprint the-missing-heartwood
npm run eval:playtest -- --blueprint the-missing-heartwood --persona kid-7 --games 3
npm run eval:playtest -- --replay evaluation/playtest/runs/<run>/game-1/script.json
```

Needs a logged-in `claude` CLI (both the narrator and the investigator run
through it) and nothing else: no API key, no env file. It builds the web app,
starts it on a free port against a throwaway database, and never touches yours.

Read `evaluation/playtest/runs/<run>/game-<n>/transcript.md`.

| Option | Default | |
| --- | --- | --- |
| `--blueprint <x>` | required, unless `--replay` | An id, file name or title of a blueprint in the repo's `blueprints/`, or a path to any blueprint JSON (copied into the throwaway config root). Blueprints generated into your own config root need the path. With `--replay`, the script's blueprint |
| `--replay <script.json>` | | Replay a recorded game's inputs instead of asking an investigator; see [Replay](#replay) |
| `--persona <name>` | `detective` | A file in `personas/`. Not with `--replay` |
| `--games <n>` | `1` | Games to play (with `--replay`, the same script N times) |
| `--concurrency <n>` | `2` | Games at once |
| `--max-steps <n>` | `60`; the whole script with `--replay` | Inputs per game before giving up |
| `--narrator <claude\|mock>` | `claude` | `mock` for plumbing checks only |
| `--narrator-model <m>` | `sonnet` | |
| `--investigator-model <m>` | `sonnet` | Not with `--replay` |
| `--out <dir>` | `evaluation/playtest/runs` | Gitignored |
| `--port <n>` | a free port | Where the throwaway server listens |

## How a turn works

```
view (what a player sees) ──► investigator (claude -p, persona)
                                   │ one line of input
                                   ▼
                  web/src/lib/domain/parser.ts  (the UI's own parser)
                                   │ command, or the UI's hint
                                   ▼
                  POST /api/game-*  ──► engine ──► claude-cli narrator
                                   │
                  GET /api/game-get ──► next view
```

- **The runner makes no choices.** Every input comes from the investigator
  after it reads the latest narration. The one step it takes itself is the
  browser's: after `game-start` narrates the premise, `game-enter` (the
  player's "press any key") narrates the arrival.
- **The investigator sees what a player sees, and no more.** The view
  (`lib/view.mjs`) is the status line plus the notebook's four sections, built
  with the web app's own notebook helpers (`web/src/lib/domain/notebook.ts`),
  and the story so far. It is built from the session state the API returns to
  the browser, never from the blueprint.
- **Input is handled as the browser handles it.** The line goes through the
  UI's parser. A line the parser rejects gets the UI's hint, in the store's
  exact wording, and costs no turn. Routing to endpoints (`lib/commands.mjs`)
  mirrors `getBackendInvocation` in `web/src/lib/domain/store.svelte.ts`,
  including free text in accuse mode going to `game-accuse` as reasoning, and
  failed calls are retried by the store's own rule
  (`web/src/lib/domain/store.retry.ts`). Keep the two in step.
- **Where the browser shows a screen, the view says so in words.** `help`
  lists the mode's commands, `notebook` points at the notebook sections (and,
  as in the store, is not echoed), and theme commands only change colours. A
  response's `follow_up_prompt` is not shown, because the web UI does not show
  it; it is in `steps.jsonl`.
- **No hidden memory.** Each investigator call gets the whole view and history,
  so any step can be read back from `steps.jsonl`.
- **A game stops** when the case ends, the investigator types `quit`, three
  calls in a row fail, the game state cannot be read, the investigator itself
  fails, `--max-steps` runs out, or a replay runs out of script
  (`no-more-input`) or diverges (`diverged`). Its folder is written either way, with the
  reason in `summary.json`. The narrator's calls are capped at 90 seconds so a
  slow turn fails as a turn rather than outlasting the request.

## A run folder

```
runs/<timestamp>-<blueprint>-<persona>/
├── game.db               the throwaway database, kept: every game's session and events
├── ai-calls.all.jsonl    every narrator call the server made (AI_CALL_LOG)
├── summary.json          one summary per game
└── game-<n>/
    ├── transcript.md     the game as read, with the investigator's plan in italics
    ├── script.json       the investigator's inputs, in order, each with a checkpoint
    ├── steps.jsonl       per step: view shown, checkpoint, input, action, API response
    ├── ai-calls.jsonl    this game's narrator calls
    └── summary.json      outcome, stop reason, turns used, clues found of total, costs
```

## Replay

`--replay <script.json>` types a recorded game's inputs again, with no
investigator calls, so a narrator or prompt change can be compared with the
original on the same inputs. Set the change up (an edited prompt, another
`--narrator-model`), replay, and read the two `transcript.md` files side by
side. Replaying one script with `--games 3` shows how much the narration varies
on its own.

Narration differs from run to run, so a replay can reach a point where an input
no longer means what it did. Each input in `script.json` is saved with a
checkpoint of the game just before it was typed: the mode, the place, who is
being talked to, the people there, and the clues found so far. `end` is one
more, of the game when play stopped. Before each input the replay compares the
checkpoint with the live game, and after the last input it compares `end`:

- If the mode, place, talk partner or people there differ, the replay stops
  with `stop_reason: "diverged"`. `summary.json` has `divergence`: the step, the
  input it did not type (`null` after the last one), and each field as recorded
  and as found. The transcript's footer says the same.
- A game that ends while the script has more to type has diverged too: the
  accusation was settled in fewer rounds. One that is still going when the
  script runs out shows up in the comparison with `end`.
- If only the clues differ (a clue came a turn earlier or later), it carries
  on. The first such step is `clue_drift` in `summary.json`.

A script without checkpoints (saved before they existed, or written by hand)
replays with a warning and no checks. A replay writes its own `script.json`, of
the inputs it played.

## Grading

A game can be graded later with the trace pipeline:

```bash
npm run eval:trace:extract -- --db <run>/game.db --session <game_id> --out trace.json
npm run eval:trace -- --trace trace.json
```

## Personas

`personas/*.md`, spliced into `prompts/investigator.md`. `detective` explores
methodically and accuses with evidence; `kid-7` types short, misspelled lines
and wanders off topic, which exercises the narrator's handling of input it
cannot understand. Add a persona by adding a file.

## Safeguard refusals

The investigator's reply carries a `plan` field, a note for the log. An earlier
version called it `thinking` and asked for "what you are doing next and why".
The API's safeguards read that as an attempt to extract the model's reasoning
(`Details: [reasoning_extraction]` in the refusal) and refused about three turns
in eight, on Sonnet and Opus alike. With `plan`, 8 of 8 went through on the same
view. Keep prompts and schemas from asking a model to report its reasoning.

A refusal that still happens is retried twice; after that the game stops with
`stop_reason: investigator-error` and the folder records what was played. The
narrator (`AI_PROVIDER=claude-cli`) can be refused the same way; that fails the
turn, and the transcript shows the error.

## Cost

Every turn is a narrator call and an investigator call, and the investigator's
input grows with the story. `summary.json` reports both costs per game; check
the first run's figure before playing many games.

## Tests

- `tests/api/unit/playtest-view.test.ts`: input routing and the player view.
- `tests/api/unit/playtest-replay.test.ts`: checkpoints, divergence, script files.
- `tests/api/integration/playtest.test.ts`: a scripted investigator plays the
  mock blueprint to a win on the suite's mock server, the run folder is
  written, and the game replays: unchanged to the same end; with an edited
  checkpoint, to a divergence; and to a divergence when the game ends before
  the script does, or the script before the game. No model is called.
