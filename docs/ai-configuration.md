# AI Configuration

Which AI narrates and where its key lives; setup: `QUICKSTART.md`.

## The file

`ai.json` in the config root lists the AIs this machine can narrate with; its
format: `ai.example.json`, `packages/game-engine/src/ai-config.ts`. It is
gitignored; `tracked-files` fails the gate if one is tracked. It is read once, at
start: a malformed file stops the server, a missing one leaves only mock. An
optional top-level `"default"` must name `mock` or an entry. `./dev doctor` lists
each AI's gaps and fails when the default cannot narrate. The example defaults to
`haiku`.

## Keys

An `openrouter` AI uses its own `"key"` in `ai.json`, else `OPENROUTER_API_KEY`
from the environment, then from `.env.local` in the config root. None is tracked,
and a key never reaches the browser.

## Choosing

A request names an AI or `default`, which the browser always sends. Sessions
resolve it per request, so changes reach games in play. `default` is the
first that applies:

1. **The run override**, `AI_PROFILE`, which `./dev run --ai <name>` sets for one
   process; `/settings` then shows a banner naming it.
2. **The stored choice** from `/settings`, one name per database.
3. **The file's default**, fresh databases included.
4. **Mock**.

**Never fall back to mock.** A choice or default that cannot narrate (an
`openrouter` AI with no key, or a choice gone from the file) is an error naming
it: `game-start` and turns answer `500` and write nothing, and a run override
naming one stops the server. Any other unknown name is `400 Invalid ai_profile`.

## The settings page

`/settings` works before a profile exists, so a broken choice cannot lock a
machine out. An AI without its key is listed with the reason and cannot be chosen.

## The claude CLI backend

A `claude-cli` AI narrates through the local `claude` command and its login. Each
call runs in the temp directory with Claude Code's prompt, tools, MCP servers and
settings (this repo's `CLAUDE.md` included) kept out, so a login set only in
settings (`apiKeyHelper`, Bedrock, Vertex) fails.

## The call log

`AI_CALL_LOG=<file>` appends one JSON line per AI call: full prompt, context and
output. The accusation judge's context includes the solution, so keep the file
gitignored.

## Tests and harnesses

Suites run mock by absence (`docs/testing.md`). A harness starting its own server
writes a temporary `ai.json` with only the AIs it asks for
(`scripts/lib/ai-seed.mjs`), so it never narrates with any other.

Changing resolution, the choice or a backend changes the mock and its tests
(`docs/ai-runtime.md`).
