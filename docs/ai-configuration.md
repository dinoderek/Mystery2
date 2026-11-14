# AI Configuration

Which AI narrates and where its key lives. Set-up is `QUICKSTART.md`.

## The file

`ai.json` in the config root lists the AIs this machine can narrate with.
`ai.example.json` is the template; `ai.json` is gitignored, and `tracked-files`
fails the gate if one is tracked.

```json
{ "ais": {
    "free":   { "backend": "openrouter", "model": "arcee-ai/trinity-large-preview:free" },
    "claude": { "backend": "claude-cli", "model": "sonnet" } } }
```

- `backend` is `openrouter` or `claude-cli`; `model` is required.
- `mock` is built in; naming an entry `mock` or `default` is an error.
- It is read once, at start (`packages/game-engine/src/ai-config.ts`). A
  malformed file stops the server, naming the AI and field; a missing one
  leaves only mock. `./dev doctor` lists each AI and its gaps.

## Keys

An `openrouter` AI uses its own `"key"` in the file, else `OPENROUTER_API_KEY`
from the environment, then from `.env.local` in the config root. `claude-cli`
needs none. Keys never reach the browser.

## Choosing

A request names an AI or `default`, which the browser always sends. Sessions
resolve it on every request, so a change reaches a game in play. `default` is
the first that applies:

1. **The run override**, `AI_PROFILE`, which `./dev run --ai <name>` sets for
   one process. The settings page then shows a banner naming it.
2. **The stored choice** from `/settings`, one name in `app_settings`, per
   database.
3. **Mock.** A fresh database has no choice.

A name not `mock`, `default` or in the file is `400 Invalid ai_profile`. An AI that
cannot narrate (an `openrouter` AI with no key, or a stored choice gone from the
file) is an error naming it, never a fall back to mock: `game-start` and turns
answer `500` and write nothing, and a run override naming one stops the server.

## The settings page

`/settings` works before a profile exists, so a broken choice cannot lock a
machine out. It lists mock and each AI
with backend and model, marks the choice, and stores one name
(`packages/game-engine/src/ai-choice.ts`). An AI without its key is listed with
the reason and cannot be chosen.

## The claude CLI backend

A `claude-cli` AI narrates through the local `claude` command and its own
login, `./dev run --ai
<name>` refuses to start without the executable. Each call is one `claude
--print` subprocess with OpenRouter's messages, its output constrained by
`--json-schema`. Flags keep Claude Code's own prompt, tools, MCP servers and
settings (including this repo's `CLAUDE.md`) out of the context, and it runs in
the temp directory, so a login configured only in settings (`apiKeyHelper`,
Bedrock, Vertex) fails.

`CLAUDE_CLI_PATH`, `AI_CLAUDE_CLI_TIMEOUT_MS` (120000),
`AI_CLAUDE_CLI_MAX_ATTEMPTS` (3) and `AI_CLAUDE_CLI_BASE_BACKOFF_MS` (750) tune
it. A timeout, failed run, or reply flagged `is_error` or missing its output is
retried; one that breaks a parser rule fails at once, as for OpenRouter.

## The call log

`AI_CALL_LOG=<file>` appends one JSON line per AI call, whatever the backend:
role, prompt and context sent, what the parser was given, latency and, from
the claude CLI, tokens, cost and attempts. A relative path resolves against the
repo root. The accusation judge's context includes the solution: keep the file
gitignored.

## Tests and harnesses

Suites run mock by absence: no `ai.json`, no run override, nothing chosen
(`docs/testing.md`).

A harness that starts a server of its own (live runners, self-play, turn
judging) writes its temporary `ai.json` with only the AIs it was asked for, keys
copied from the config root it is pointed at, and names one per request
(`scripts/lib/ai-seed.mjs`). A missing name or key fails before it starts.

Changing resolution, the choice or a backend changes the mock and its tests too
(`docs/ai-runtime.md`, "The mock provider").
