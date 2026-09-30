# Quickstart Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 24 (see `.nvmrc`), [npm](https://www.npmjs.com/)

That is the whole list. The game is one Node process over a SQLite file.

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
  .env.local
  .env.ai.free.local
  .env.ai.paid.local
  .env.images.local
  database/
    prod/game.db
    <worktree>/game.db
  blueprints/
  blueprint-images/
```

Blueprints and images are shared across worktrees; databases are not. Each
worktree gets its own, and `npm run prod` opens the persistent `prod` one. See
`docs/local-infrastructure.md`.

**Bootstrap:**

```bash
npm ci
```

There is nothing to seed. The database is created on first run, and blueprints
are read off disk — the two committed in `blueprints/` are enough to play.

## Local Development

### Mock AI (default)

```bash
npm run dev
```

Starts the game at `http://127.0.0.1:51000` (a worktree gets its own port; the
command prints it). Mock narration, no network, no API key.

Pick a profile name on the first screen — that is the whole of signing in.

This checkout plays against a database of its own, thrown away whenever you
like. `npm run prod` starts the same server against the persistent one instead.

### Live AI

The quickest route is the settings page: `[ AI SETTINGS ]` on the profile
picker, reachable before you have picked a profile. Add a key and a model, pick
them, switch to Real AI. The choice is stored and survives a restart.

To have keys and models already there, create the gitignored
`.env.ai.local` in the config root:

```bash
OPENROUTER_KEY_PERSONAL="<key>"
AI_MODEL_SONNET="anthropic/claude-sonnet-4"
AI_MODEL_LLAMA_FREE="meta-llama/llama-3.3-70b-instruct:free"
```

Each entry becomes a labelled choice on the settings page — `personal`,
`sonnet`, `llama_free`. They are re-read on every start, so that file stays the
place to rotate a key, and a label removed from it disappears from the page.

### The free/paid profiles

Separate from the above, and still file-backed, because the live-AI test suites
and the evaluation harness name them explicitly.

`.env.ai.free.local` / `.env.ai.paid.local`:

```bash
AI_PROVIDER="openrouter"
AI_MODEL="<model-id>"
OPENROUTER_API_KEY="<key>"
```

```bash
npm run dev:ai:free   # or dev:ai:paid
npm run dev:ai:claude # Sonnet through the local claude CLI, no key or env file
```

These start the server with an override that outranks whatever the settings
page has chosen, for the life of the process. The settings page shows a banner
saying so while it is in effect. The `free` and `paid` keys and models also
appear on the page under those labels, so they can be picked without the
override; the claude CLI cannot be picked there.

### Switching model

Change it on the settings page; no restart. Because a session's profile is
resolved on every request, the switch takes effect on the next turn of a session
already in progress.

Existing sessions keep the profile *label* they were started with, which is
what the evaluation pipeline reads.
See [`docs/ai-configuration.md`](docs/ai-configuration.md).

## Profiles

There are no seeded accounts. Type a name on the first screen and that profile
exists; type a different one and you get a separate set of cases. Profiles are
local to the machine and have no passwords — they keep one person's cases apart
from another's, not anyone out.

## Blueprint Generation

Create a brief JSON:

```json
{
  "brief": "A child-friendly mystery in a school library.",
  "targetAge": 8,
  "timeBudget": 14,
  "mustInclude": ["at least three suspects", "one red herring motive"]
}
```

### Generate blueprints (calls OpenRouter)

```bash
npm run generate:blueprint -- \
  --brief-file path/to/story-brief.json \
  --model openai/gpt-4.1-mini
```

Each blueprint is written with a sibling `.verification.json`: the evaluation
pipeline's mechanical checks, run offline. For a full evaluation run
`npm run eval`. Set `OPENROUTER_BLUEPRINT_MODEL` in `.env.local` to stop
repeating `--model`.

### Export chat packets (no API key needed)

```bash
npm run generate:blueprint -- \
  --brief-file path/to/story-brief.json \
  --chat-packet
```

Writes the full generation prompt as Markdown to paste into any chat UI.

Every flag, default and file location: `node scripts/generate-blueprint.mjs --help`.

## Evaluation Pipelines

Four evaluation pipelines, each for a different subject. Each is driven by npm
scripts and documented next to its code. Pass-through flags go after `--`.

| Pipeline | What it evaluates | npm scripts |
|----------|-------------------|-------------|
| Blueprint | Generated mystery blueprints | `npm run eval` |
| Trace | Played game-master traces | `npm run eval:trace`, `npm run eval:trace:extract` |
| Runtime | Live narrator responses to a single action | `npm run eval:runtime`, `npm run eval:runtime:rejudge`, `npm run eval:cases-from-trace` |
| Playtest | Whole games played by an AI investigator | `npm run eval:playtest` |

Start with [`docs/evaluation-pipeline.md`](docs/evaluation-pipeline.md) for the
shared design, then the per-pipeline runbooks:
[`evaluation/README.md`](evaluation/README.md) (blueprint),
[`evaluation/trace/README.md`](evaluation/trace/README.md) (trace), and
[`evaluation/runtime/README.md`](evaluation/runtime/README.md) (runtime), and
[`evaluation/playtest/README.md`](evaluation/playtest/README.md) (playtest).

```bash
npm run eval -- --help                       # blueprint eval
npm run eval:trace -- --help                 # trace eval
npm run eval:trace:extract -- --help         # pull a trace from a played session
npm run eval:runtime -- <case-or-dir>        # eval a runtime case
npm run eval:runtime:rejudge -- <interaction.json>  # re-judge a stored interaction
npm run eval:cases-from-trace -- <trace.json>       # build runtime cases from a trace
```

## Image Generation

Copy `.env.images.example` to `.env.images.local` and set `OPENROUTER_API_KEY`.

```bash
npm run generate:images -- --blueprint-path spring-treats-6yo.json --all
npm run generate:images -- --blueprint-path spring-treats-6yo.json --characters <character-id>
npm run generate:images -- --blueprint-path spring-treats-6yo.json --all --chat-packets  # no key needed
```

Every flag, default and file location: `node scripts/generate-blueprint-images.mjs --help`.
Which blueprint fields shape each image: `docs/blueprint-generation-flows.md`.

## Running The Game

There is no stack to start, restart, reset, or garbage-collect. `vite dev`
reloads the engine like any other source file.

### Worktrees

Each worktree gets its own port (`51000 + slot`) and its own database
(`database/<worktree name>/game.db`), so two checkouts can run side by side.
Nothing else needs isolating.

### Looking at your data

`npm run db:list` shows every database with its row counts and path;
`db:init`, `db:reset`, and `db:copy` create, empty, and snapshot them. Each is
a SQLite file, readable while the game is running:

```bash
sqlite3 "${MYSTERY_CONFIG_ROOT:-.}/database/prod/game.db" "select outcome, count(*) from game_sessions group by 1;"
```

To pull one session out as a self-contained artifact for the trace pipeline:

```bash
npm run eval:trace:extract -- --session <id>
```

See [`docs/local-infrastructure.md`](docs/local-infrastructure.md) for the full
runbook and troubleshooting.

## Testing

Full quality gate:

```bash
npm test
```

Individual tiers:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```

See [`docs/testing.md`](docs/testing.md) for suite ownership and guidance.

The suites start the game themselves against a temporary database, so there is
nothing to have running first — and nothing they can do to the sessions you
have played.
