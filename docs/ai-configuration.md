# AI Configuration

Which model narrates, how that is chosen, and where keys live. How the narrator
is prompted is `docs/ai-runtime.md`; setting a machine up is `QUICKSTART.md`.

## The AIs: `ai.json`

`ai.json` in the config root names the AIs this machine can narrate with.
`ai.example.json` is the committed template; `ai.json` itself is gitignored at
any depth, and the gate's `tracked-files` step fails if one is ever tracked.

```json
{ "ais": {
    "free":   { "backend": "openrouter", "model": "arcee-ai/trinity-large-preview:free" },
    "claude": { "backend": "claude-cli", "model": "sonnet" } } }
```

- `backend` is `openrouter` or `claude-cli`. An `openrouter` entry may carry its
  `"key"` in clear; without one it uses `OPENROUTER_API_KEY` from the
  environment, then from `.env.local`. `claude-cli` needs none.
- `mock` is built in and needs no entry; an entry named `mock` or `default` is
  an error.
- The server reads the file once, at start
  (`packages/game-engine/src/ai-config.ts`). A malformed one stops the server,
  `./dev run` and `./dev doctor`, naming the AI and the field; a missing one
  leaves mock as the only AI. Changing an AI is editing the file and restarting.
  `./dev doctor` lists each AI and whether it has its key or executable.

## Choosing

A request names an AI or uses `default`, which the browser always does. A
session stores that name and resolves it again on every request, so a choice
made on the page reaches a session in play. `default` is the first that applies:

1. **The run override**, `AI_PROFILE`, which `./dev run --ai <name>` sets for
   one run. While it is in force the settings page shows a banner naming it,
   because a stored choice quietly not in effect is worse than none. The banner
   and the resolver read the same `readRunOverride` result.
2. **The settings database**, the choice last made on `/settings`.
3. **Mock.**

- A name that is not `mock`, `default` or in the file returns `null`, which
  `game-start` answers with `400 Invalid ai_profile`.
- An `openrouter` AI with no key anywhere throws when it is resolved, naming
  it, and surfaces as a 500; a run override naming a missing or broken AI stops
  the server from starting. Neither falls back to mock.
- Keys are read on the server and never reach the browser. The settings
  endpoints return a key's last four characters and nothing else.

## The settings page

`/settings` is reachable from the profile picker **before a profile exists**: a
machine whose AI is misconfigured is exactly the one a player cannot get past
the picker on.

- **Mock or real AI.** Real AI is refused until a key and a model are both
  selected, so a stored `openrouter` choice is always one the runtime can call.
- **Labelled keys and models**, each a label → value pair that can be added,
  replaced or deleted.
- Rows have a `source`. `env` rows come from files, are re-read on every start,
  show `[ENV]`, and refuse edits and deletes — an edit the next restart would
  silently undo is worse than none. `user` rows were typed on the page. A `user`
  row wins over an `env` row with the same label.
- A selection is stored as a label and may dangle: if a reseed removes it,
  narration falls back to mock and the page names the missing label. The
  comment above the AI tables in `packages/game-engine/src/db/schema.ts` says
  why the tables key on labels.

### Seeding from files

On every start, all `env` rows are deleted and re-inserted, not upserted, so a
label removed from a file disappears instead of lingering as a dead choice.

| File | Becomes |
|---|---|
| `.env.local` `OPENROUTER_API_KEY` | key `default` |
| `.env.ai.free.local`, `.env.ai.paid.local` | key and model `free`, `paid` |
| `.env.ai.local` `OPENROUTER_KEY_<LABEL>`, `AI_MODEL_<LABEL>` | key or model `<label>`, lowercased |

Later rows win.

## The claude CLI provider

A `claude-cli` AI narrates through the local `claude` command and its own login,
for machines that reach Anthropic but not OpenRouter — a cloud container, say.

- `./dev run --ai <name>` refuses to start a `claude-cli` AI without the
  executable. A run override or a request naming it selects one; the settings
  page cannot.
- Each call is one `claude --print` subprocess with the same messages the
  OpenRouter provider sends, its output constrained by `--json-schema` from the
  role's contract. Flags keep Claude Code's own system prompt, tools, MCP
  servers and settings — including this repo's `CLAUDE.md` — out of the
  model's context, and it runs in the OS temp directory. Skipping settings also
  skips a login configured only there (`apiKeyHelper`, Bedrock, Vertex), which
  then fails to authenticate.
- `CLAUDE_CLI_PATH` (the executable; a wrapper script is fine),
  `AI_CLAUDE_CLI_TIMEOUT_MS` (120000), `AI_CLAUDE_CLI_MAX_ATTEMPTS` (3) and
  `AI_CLAUDE_CLI_BASE_BACKOFF_MS` (750) tune it.
- A timeout, a failed run, or a reply flagged `is_error` or missing its output
  is retried, then surfaces as the usual retriable AI error. A reply that
  matches the schema but breaks a parser-only rule fails at once, as it does for
  OpenRouter.

## The AI call log

`AI_CALL_LOG=<file>` appends one JSON line per AI call, whatever the provider:
role, request metadata, the prompt and context sent, what the parser was given,
whether it parsed, latency, and — from the claude CLI — tokens, cost and
attempts. The context includes the solution for the accusation judge, so keep
the file somewhere gitignored. The launcher resolves a relative path against
the repo root; the mock suites clear the variable.

## Operator tools

Blueprint and image generation read keys from the shell and the config root's
env files, never from the settings tables; blueprint models come from
`evaluation/config.json` or `--model`. Their flags, defaults and precedence are
in their own help:

```bash
./dev eval generate --help
node scripts/generate-blueprint-images.mjs --help
```

What each one feeds from a blueprint is `docs/blueprint-generation-flows.md`;
worked examples are in `QUICKSTART.md`.

## Tests

Every suite runs mock by absence: its server gets a config root with no
`ai.json`, no run override and an empty settings row. The settings row belongs to the
installation, not a profile, so a suite sharing a server with game-playing tests
must never switch it to live. `docs/testing.md` has the rule and the backstop.

A harness that starts a server of its own (the live runners, self-play, turn
judging) writes that server's temporary `ai.json` with only the AIs it was asked
for, copied with their keys from the `ai.json` of the config root it is pointed
at, and names one on each request (`scripts/lib/ai-seed.mjs`). A name that is
missing, or an `openrouter` AI with no key, fails before the server starts. A
live run calls nothing unless given a name, and reads no `.env.ai.*` or
`AI_MODEL`. A trace takes its model from the game's events and resolves nothing.

Changing profile resolution, the settings store or a provider changes the mock
and its tests in the same change (`docs/ai-runtime.md`, "The mock provider").
