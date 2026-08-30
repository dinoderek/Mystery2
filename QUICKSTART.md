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

Create one or both gitignored env files for live provider calls:

`.env.ai.free.local` / `.env.ai.paid.local`:

```bash
AI_PROVIDER="openrouter"
AI_MODEL="<model-id>"
OPENROUTER_API_KEY="<key>"
```

Then:

```bash
npm run dev:ai:free   # or dev:ai:paid
```

### Switching model

Stop the server and start the other command. Profiles are environment, not
database rows, so there is nothing to reseed — and because a session's profile
is resolved on every request, editing `.env.ai.free.local` takes effect on the
next turn of a session already in progress.

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

Key flags:

| Flag | Purpose |
|------|---------|
| `--openrouter-api-key <key>` | Explicit key (falls back to `OPENROUTER_API_KEY` env) |
| `--output <path>` | Write single job to exact file (stdout otherwise) |
| `--output-file <prefix>` | Write composed filenames `<prefix>.<model>.<brief>.json` |
| `--parallel` / `--parallelism <n>` | Concurrent jobs |

Repeat `--brief-file` and/or `--model` for multi-job runs (requires
`--output-file`). Set `OPENROUTER_BLUEPRINT_MODEL` in `.env.local` to avoid
repeating `--model`.

Both the blueprint and a sibling `.verification.json` file are written on
completion. Verification is a purely structural, offline check that runs the
shared deterministic checks (schema validity, culprit/location/character/
red-herring counts vs. the brief, orphan clues, and a satisfiable clue graph)
against the just-written blueprint — no verifier model and no extra network
call. The `.verification.json` record reports `passed`, the individual `checks`,
and any `failed_checks`. Schema or structural-check failures are reported in the
summary without failing the process. For deeper semantic evaluation
(brief-alignment, dead-ends, fairness), run the evaluation pipeline (`npm run
eval`).

### Export chat packets (no API key needed)

```bash
npm run generate:blueprint -- \
  --brief-file path/to/story-brief.json \
  --chat-packet
```

Builds the full generation prompt as a Markdown file you can paste into any
chat UI. No `--model` or API key required. Output defaults to
`$MYSTERY_CONFIG_ROOT/chat-gen-prompts/` (or `chat-gen-prompts/` under repo
root). Override with `--output` or `--output-file`.

## Evaluation Pipelines

Three peer evaluation pipelines score different artifacts. Each is driven by npm
scripts and documented next to its code. Pass-through flags go after `--`.

| Pipeline | What it evaluates | npm scripts |
|----------|-------------------|-------------|
| Blueprint | Generated mystery blueprints | `npm run eval` |
| Trace | Played game-master traces | `npm run eval:trace`, `npm run eval:trace:extract` |
| Runtime | Live narrator responses to a single action | `npm run eval:runtime`, `npm run eval:runtime:rejudge`, `npm run eval:cases-from-trace` |

Start with [`docs/evaluation-pipeline.md`](docs/evaluation-pipeline.md) for the
shared design, then the per-pipeline runbooks:
[`evaluation/README.md`](evaluation/README.md) (blueprint),
[`evaluation/trace/README.md`](evaluation/trace/README.md) (trace), and
[`evaluation/runtime/README.md`](evaluation/runtime/README.md) (runtime).

```bash
npm run eval -- --help                       # blueprint eval
npm run eval:trace -- --help                 # trace eval
npm run eval:trace:extract -- --help         # pull a trace from a played session
npm run eval:runtime -- <case-or-dir>        # eval a runtime case
npm run eval:runtime:rejudge -- <interaction.json>  # re-judge a stored interaction
npm run eval:cases-from-trace -- <trace.json>       # build runtime cases from a trace
```

## Image Generation

Env file: copy `.env.images.example` to `.env.images.local`.

Supported keys: `OPENROUTER_API_KEY`, optional `OPENROUTER_IMAGE_MODEL`
(default: `openai/gpt-image-2`), optional `OPENROUTER_IMAGE_ASPECT_RATIO`
(default: `4:3`).

### Generate images (calls the OpenRouter Images API)

```bash
npm run generate:images -- \
  --blueprint-path spring-treats-6yo.json \
  --model openai/gpt-image-2 \
  --all
```

Key flags:

| Flag | Purpose |
|------|---------|
| `--all` | All targets |
| `--blueprint` | Blueprint-level image only |
| `--characters "A,B"` / `--character "A"` | Character subset |
| `--locations "X,Y"` / `--location "X"` | Location subset |
| `--model <id>` | Override the image model |
| `--aspect-ratio <ratio>` | Output aspect ratio (default `4:3`; must be supported by the model) |
| `--output-dir <dir>` | Override output directory |
| `--dry-mode` | Print the Images API request (base64 redacted) without calling it |

Aspect-ratio support varies by model — `openai/gpt-image-1` accepts only
`1:1`, `3:2`, `2:3`, and `auto`, so pass `--aspect-ratio 3:2` if you pin it.
`curl https://openrouter.ai/api/v1/images/models` (public, no auth) lists each
model's `supported_parameters`.

`--blueprint-path` resolves from `$MYSTERY_CONFIG_ROOT/blueprints/` first, then
falls back to the literal path. `--output-dir` defaults to
`$MYSTERY_CONFIG_ROOT/blueprint-images/` (or `blueprint-images/`).

### Export image chat packets (no API key needed)

```bash
npm run generate:images -- \
  --blueprint-path spring-treats-6yo.json \
  --all \
  --chat-packets
```

Writes Markdown prompt files instead of calling OpenRouter. Output defaults to
`$MYSTERY_CONFIG_ROOT/chat-gen-prompts/images/`. Cannot combine with
`--dry-mode` or `--dry-run`.

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
