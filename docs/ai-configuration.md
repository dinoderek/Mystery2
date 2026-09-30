# AI Configuration

Which model narrates, how that is chosen, and where keys live. How the narrator
is prompted is `docs/ai-runtime.md`; setting a machine up is `QUICKSTART.md`.

## Profiles

A session narrates through a **profile**, and there are four:

| Profile | Where it comes from | Who uses it |
|---|---|---|
| `mock` | Built in; no key, no network | Every automated suite, and the fallback |
| `free`, `paid` | `.env.ai.free.local`, `.env.ai.paid.local` in the config root | The live-AI suites and the evaluation harness, which name them explicitly |
| `default` | Resolved per request (below) | The browser, always |

`free` and `paid` are files so a run can be reproduced from what it was handed.
`default` is what a person chooses, so it is chosen on a page and stored.

- `game-start` uses `default` unless the request names an `ai_profile`; the
  browser never does.
- A session stores its profile **label**, and the label is resolved again on
  every request, so a configuration change reaches a session already in play,
  with no restart. The model that actually answered is on each event
  (`docs/ai-runtime.md`).
- A **misconfigured** profile — unknown provider, no model, `openrouter` with
  no key — throws and surfaces as a 500. One simply not configured here returns
  `null`, which `game-start` answers with `400 Invalid ai_profile`. Neither
  falls back to mock silently.
- Keys are read on the server and never reach the browser. The settings
  endpoints return a key's last four characters and nothing else.

## How `default` resolves

The first source that describes a usable configuration wins
(`packages/game-engine/src/ai-profile.ts`):

1. **The process environment** — `AI_PROVIDER` and `AI_MODEL`, over
   `.env.local`. This is what `npm run dev:ai:free`, `dev:ai:paid` and
   `dev:ai:claude` set, and what keeps the test server on mock, by its absence.
   A *broken* override throws rather than falling through: a typo in an explicit
   choice must not quietly become something else.
2. **The settings database** — the mode, key and model last chosen on
   `/settings`.
3. **Mock.**

`OPENROUTER_API_KEY` alone is not an override; only the two variables that
select a configuration are. When step 1 is in force, the settings page shows a
banner naming what is forced, because a stored choice quietly not in effect is
worse than none. The banner and the resolver read the same function
(`readDefaultAIOverride`), so they cannot disagree.

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

Later rows win. The first two mean a machine already set up for
`npm run dev:ai:free` has choices on the page without editing anything.

## The claude CLI provider

`AI_PROVIDER=claude-cli` narrates through the local `claude` command and its
own login, for machines that reach Anthropic but not OpenRouter — a cloud
container, say. No key, no env file:

```bash
npm run dev:ai:claude                     # Sonnet
CLAUDE_MODEL=haiku npm run dev:ai:claude  # any model the CLI accepts
```

- The launcher reads `CLAUDE_MODEL`, not `AI_MODEL`, so a leftover OpenRouter
  model id is never handed to the CLI, and it refuses to start without `claude`
  installed.
- It is chosen only through the process environment: the settings page shows it
  in the override banner but cannot select it. Keep it out of `.env.ai.free.local`
  and `.env.ai.paid.local`, whose `AI_MODEL` the page seeds as an OpenRouter
  model.
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

Blueprint and image generation read keys and models from the shell and the
config root's env files, never from the settings tables. Their flags, defaults
and precedence are in their own help:

```bash
node scripts/generate-blueprint.mjs --help
node scripts/generate-blueprint-images.mjs --help
```

What each one feeds from a blueprint is `docs/blueprint-generation-flows.md`;
worked examples are in `QUICKSTART.md`.

## Tests

Every suite runs mock by absence: its server gets a config root with no
`.env.ai.*` and an empty settings row. The settings row belongs to the
installation, not a profile, so a suite sharing a server with game-playing tests
must never switch it to live. `docs/testing.md` has the rule and the backstop.

Changing profile resolution, the settings store or a provider changes the mock
and its tests in the same change (`docs/ai-runtime.md`, "The mock provider").
