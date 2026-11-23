# Quickstart Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 24 (see `.nvmrc`), [npm](https://www.npmjs.com/)

## First-Time Setup

**Optional shared config root** — to share local-only files across clones or
worktrees, export an absolute path before any other command:

```bash
export MYSTERY_CONFIG_ROOT="/absolute/path/to/mystery-config"
```

When set, gitignored files (`.env.*.local`, seed files, generated outputs)
resolve from that directory instead of the repo root. Layout mirrors repo-local
filenames:

```text
$MYSTERY_CONFIG_ROOT/
  ai.json
  .env.local
  .env.images.local
  database/
    prod/game.db
    <worktree>/game.db
  blueprints/
  blueprint-images/
  blueprint-scenes/
```

Blueprints and images are shared across worktrees; databases are not. Each
worktree gets its own, and `npm run prod` opens the persistent `prod` one. See
`docs/local-infrastructure.md`.

**Bootstrap:**

```bash
./dev doctor
```

Checks dependencies, Playwright and the port. Worktrees: `./dev worktree create
<branch>`; see `docs/local-infrastructure.md`.

There is nothing to seed. The database is created on first run, and blueprints
are read off disk — the committed stories in `blueprints/` are enough to play.

## Local Development

### Mock AI (default)

```bash
npm run dev
```

Starts the game at `http://127.0.0.1:51000` (a worktree gets its own port; the
command prints it). Mock narration, no network, no API key.

Pick a profile name on the first screen — that is the whole of signing in.

### Compare case formats

Choose **The Missing Lighthouse Lens** for V2 (the default), or **The Missing
Lighthouse Lens — MSF experiment** for native MSF. Keep the same narrator.
For a recorded comparison:

```bash
./dev eval play --blueprint the-missing-lighthouse-lens --games 1 --judge
./dev eval play --replay <baseline>/script.json --blueprint blueprints/msf/lighthouse.json --judge
```

Use a game's saved script from the first run. [Experiment details](docs/msf-gameplay.md).
**The Smashed Prize Pumpkin — clue graph** plays the [clue graph](docs/clue-graph.md).
Database versions 4 and 5 add private MSF and clue-graph snapshots; existing
games are kept, but older checkouts cannot open the upgraded database.

### Live AI

Copy `ai.example.json` to `ai.json` in the config root (gitignored) and list
your AIs by name:

```json
{ "ais": {
    "free":   { "backend": "openrouter", "model": "<model-id>", "key": "<key>" },
    "claude": { "backend": "claude-cli", "model": "sonnet" } } }
```

Add a `"key"`, or leave it out and put `OPENROUTER_API_KEY` in `.env.local`.
`./dev doctor` checks the file. Start, then choose one on `/settings`
(`[ AI SETTINGS ]` on the profile picker, reachable before you have picked a
profile). The choice is stored per database and survives a restart; a fresh
database is mock, and the picker names the narrator.

### Naming an AI for a run

```bash
./dev run --ai free              # or npm run dev -- --ai free
npm run prod -- --ai claude      # the claude CLI and its login, no key
```

The AI named outranks whatever the settings page has chosen, for the life of the
process, and the page shows a banner saying so.

### Switching model

Change it on the settings page; no restart. A session resolves its AI on every
request, so the switch takes effect on the next turn of a game in progress. A
new or edited `ai.json` entry needs a restart.

Existing sessions keep the AI name they were started with, which is what the
evaluation pipeline reads.
See [`docs/ai-configuration.md`](docs/ai-configuration.md).

## Profiles

There are no seeded accounts. Type a name on the first screen and that profile
exists; type a different one and you get a separate set of cases. Profiles are
local to the machine and have no passwords — they keep one person's cases apart
from another's, not anyone out.

## Blueprint Generation

A brief names the story, reading age and size (`small`, `medium` or `large`):

```json
{ "brief": "A missing cake at a village fete.", "targetAge": 8, "size": "small" }
```

```bash
./dev generate path/to/brief.json --judge --install
./dev generate --format v2 path/to/story-brief.json --backend api --model openai/gpt-4.1-mini
```

A clue-graph case, the default, is written by the Claude agent on your Claude
login. Up to two repair rounds fix what the validator and, with `--judge`, the
judges report; `--install` copies a case that passed into
`blueprints/clue-graph/` in the config root. `--format v2` writes a Blueprint V2
from a story brief (`targetAge`, `timeBudget`, `mustInclude`): `api` makes one
OpenRouter call and needs `OPENROUTER_API_KEY` in the shell or the config root's
`.env.local`, and `model` on `generator-api` in `evaluation/config.json` is
its default.

Flags: `./dev generate --help`.

## Evaluation Pipelines

Evaluation pipelines and their runbooks:

| Pipeline | What it evaluates | Commands |
|----------|-------------------|----------|
| Blueprint | Generated mystery blueprints | `./dev generate`, `./dev eval judge blueprint` |
| Trace | Played game-master traces | `./dev eval judge game` |
| Runtime | Live narrator responses to a single action | `./dev eval judge turn`, `./dev eval cases` |
| Playtest | Whole games played by an AI investigator | `./dev eval play` |

Start with [`docs/evaluation-pipeline.md`](docs/evaluation-pipeline.md) for the
shared design, then the per-pipeline runbooks:
[`evaluation/README.md`](evaluation/README.md) (blueprint),
[`evaluation/trace/README.md`](evaluation/trace/README.md) (trace), and
[`evaluation/runtime/README.md`](evaluation/runtime/README.md) (runtime), and
[`evaluation/playtest/README.md`](evaluation/playtest/README.md) (playtest).

```bash
./dev generate <brief> --judge             # generate and judge a case
./dev eval judge game <session-id|trace.json>   # judge a played game
./dev eval judge turn <case-or-dir>          # eval a runtime case
./dev eval judge turn <run>/<subject>/turn.json  # judge a stored turn again
./dev eval cases <trace.json>                # build runtime cases from a trace
```


`./dev eval` reads its model bindings from one file; to change one, copy
`evaluation/config.example.json` to `evaluation/config.json`.

## Image Generation

Copy `.env.images.example` to `.env.images.local` and set `OPENROUTER_API_KEY`.

```bash
./dev gen-images --blueprint-path spring-treats-6yo.json --all
./dev gen-images --blueprint-path spring-treats-6yo.json --characters <character-id>
./dev gen-images --blueprint-path spring-treats-6yo.json --all --chat-packets  # no key needed
```

Every flag, default and file location: `./dev gen-images --help`.
Which blueprint fields shape each image: `docs/blueprint-generation-flows.md`.

## 3D scene recipes

The lighthouse and Heartwood cases include saved scenes and need no model.

```bash
./dev eval scenes blueprints/my-case.json --install
```

This generates missing locations through the evaluation `scene-generator`
binding (Claude CLI by default). Configure its wrapper before live generation;
existing recipes are kept. Data flow and validation:
`docs/blueprint-generation-flows.md`.

## Your data

Each worktree runs on its own port and database; `npm run prod` uses the
persistent one. `npm run db:list` shows them all, and each is a SQLite file you
can query while the game runs. `docs/local-infrastructure.md` has the runbook
and troubleshooting.

## Testing

```bash
npm test
```

The whole gate; it starts everything it needs against a throwaway database.
Suites, focused scripts and how to read the result: `docs/testing.md`.
