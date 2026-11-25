# AI Configuration

Which AI narrates and where its key lives; set-up is `QUICKSTART.md`.

## The file

`ai.json` in the config root lists the AIs this machine can narrate with; its
format is `ai.example.json` and `packages/game-engine/src/ai-config.ts`. It is
gitignored, and `tracked-files` fails the gate if one is tracked. It is read
once, at start: a malformed file stops the server, a missing one leaves only
mock. An optional top-level `"default"` must name `mock` or an entry.
`./dev doctor` lists each AI and its gaps, and fails when the default cannot
narrate. The example's default is `haiku`, the family the runtime baselines
used.

## Keys

An `openrouter` AI uses its own `"key"` in `ai.json`, else `OPENROUTER_API_KEY`
from the environment, then from `.env.local` in the config root. None of these
is tracked, and a key never reaches the browser.

## Choosing

A request names an AI or `default`, which the browser always sends. Sessions
resolve it on every request, so a change reaches a game in play. `default` is
the first that applies:

1. **The run override**, `AI_PROFILE`, which `./dev run --ai <name>` sets for
   one process. The settings page then shows a banner naming it.
2. **The stored choice** from `/settings`, one name per database.
3. **The file's default**, fresh databases included.
4. **Mock**.

**Never a fall back to mock.** A choice or default that cannot narrate (an
`openrouter` AI with no key, or a choice gone from the file) is an error naming
it: `game-start` and turns answer `500` and write nothing, and a run override
naming one stops the server. A name not `mock`, `default` or in the file is
`400 Invalid ai_profile`.

## The settings page

`/settings` works before a profile exists, so a broken choice cannot lock a
machine out. An AI without its key is listed with the reason and cannot be
chosen.

## The claude CLI backend

A `claude-cli` AI narrates through the local `claude` command and its own
login. Each call runs in the temp directory with Claude Code's own prompt,
tools, MCP servers and settings (this repo's `CLAUDE.md` included) kept out of
the context, so a login configured only in settings (`apiKeyHelper`, Bedrock,
Vertex) fails.

## The call log

`AI_CALL_LOG=<file>` appends one JSON line per AI call with the full prompt,
context and output. The accusation judge's context includes the solution: keep
the file gitignored.

## Tests and harnesses

Suites run mock by absence (`docs/testing.md`). A harness that starts a server
of its own writes a temporary `ai.json` holding only the AIs it was asked for
(`scripts/lib/ai-seed.mjs`), so it never narrates with an AI it was not named.

Changing resolution, the choice or a backend changes the mock and its tests too
(`docs/ai-runtime.md`).
