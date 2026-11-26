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
  playtests/<date>/
```

Blueprints and images are shared across worktrees; databases are not (see
`docs/local-infrastructure.md`).

**Bootstrap:**

```bash
./dev doctor
```

Checks dependencies, Playwright and the port. Worktrees: `./dev worktree create
<branch>`; see `docs/local-infrastructure.md`.

There is nothing to seed. The database is created on first run, and blueprints
are read off disk — the committed stories in `blueprints/` are enough to play.

A database older than schema 7 is refused at start, naming its path: delete
it with `npm run db:reset` (`--force` for `prod`), which loses its games,
profiles and chosen AI.

## Local Development

### Mock AI

```bash
npm run dev
```

Starts the game at `http://127.0.0.1:51000` (a worktree gets its own port; the
command prints it). Without an `ai.json`, mock narration: no network, no API
key.

Pick a profile name (and a reading age, for a new one) on the first screen: that is signing in.

### Live AI

Copy `ai.example.json` to `ai.json` in the config root (gitignored) and list
your AIs by name:

```json
{ "ais": {
    "haiku":  { "backend": "openrouter", "model": "anthropic/claude-haiku-5.5", "key": "<key>" },
    "claude": { "backend": "claude-cli", "model": "sonnet" } },
  "default": "haiku" }
```

Add a `"key"`, or leave it out and put `OPENROUTER_API_KEY` in `.env.local`.
`"default"` narrates wherever nothing is chosen; the example's is `haiku`, Claude
Haiku over OpenRouter, so a playtest needs only the key.

To narrate with another AI, choose one on `/settings` (`[ AI SETTINGS ]` on the
profile picker, reachable before a profile is picked). The choice is stored per
database and survives a restart; the picker names the narrator.

### Naming an AI for a run

```bash
./dev run --ai free              # or npm run dev -- --ai free
npm run prod -- --ai claude      # the claude CLI and its login, no key
```

The AI named outranks the settings page's choice for the life of the process; the
page shows a banner.

### Switching model

Change it on the settings page; no restart. It takes effect on the next turn,
even mid-game. A new or edited `ai.json` entry needs a restart.

Existing sessions keep the AI name they were started with, which is what the
evaluation pipeline reads.
See [`docs/ai-configuration.md`](docs/ai-configuration.md).

### Playing on a phone or tablet

```bash
./dev run --lan
```

Serves WiFi and Tailscale, printing the addresses. Play by tap and the on-screen
keyboard, dictation included. On a Mac, allow `node` incoming connections when
the firewall asks. Rules: `docs/local-infrastructure.md`.

Playing on `prod` records each day's games, model calls and server output in
`$MYSTERY_CONFIG_ROOT/playtests/<date>/`, with a `notes.md` to fill in.

## Profiles

Type a name and choose a reading age (6 to 11) on the first screen and that
profile exists; the age can change on the settings page. A different name is a
separate set of cases. Profiles are local to the machine and have
no passwords — they keep one person's cases apart from another's, not anyone
out.

## Blueprint Generation

A brief names the story, reading age and size (`small`, `medium` or `large`):

```json
{ "brief": "A missing cake at a village fete.", "targetAge": 8, "size": "small" }
```

```bash
./dev generate path/to/brief.json --judge --install
```

A clue-graph case is written by the Claude agent on your Claude login. Up to
two repair rounds fix what the validator and, with `--judge`, the judges
report; `--install` copies a case that passed into `blueprints/clue-graph/` in
the config root.

Flags: `./dev generate --help`.

## Evaluation Pipelines

| Pipeline | What it evaluates | Commands |
|----------|-------------------|----------|
| Blueprint | Generated clue-graph cases | `./dev generate`, `./dev eval judge blueprint` |
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

## Your data

`npm run db:list` shows every database; each is a SQLite file you can query while
the game runs (`docs/local-infrastructure.md`).

## Testing

```bash
npm test
```

The whole gate, on a throwaway database.
Suites, focused scripts and how to read the result: `docs/testing.md`.
