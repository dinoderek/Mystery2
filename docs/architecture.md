# Mystery Game Architecture

## Decision summary

The game runs as **one Node process on the player's machine**. There is no
cloud backend, container or separate API service.

- **Server**: SvelteKit on `adapter-node`. One process serves the SPA and `/api`.
- **Engine**: `packages/game-engine/`. The state machine, clue graph, prompts,
  AI provider, endpoint handlers and the adapter they run against. Handlers
  reach the outside world only through `EngineContext`, which keeps storage
  substitutable (`docs/backend-conventions.md`).
- **Database**: SQLite (`better-sqlite3`), one file per worktree plus `prod`
  (`docs/local-infrastructure.md`). Tests never touch any of them.
- **Content**: blueprints, scene recipes and images, read off disk.
- **Identity**: local profiles, a name and an id. No passwords.
- **Model provider**: OpenRouter, or the local `claude` CLI, called from the
  server. A key never reaches the browser (`docs/ai-configuration.md`).

Goals: **one command** (`npm run dev` starts everything; nothing else is
installed, started, seeded or restarted); **testability** (the full gate runs
against a real server and database, with no external dependencies); **a
queryable history** (every session is an exportable row).

Non-goals: hosting, offline play, and multi-user access control. Profiles keep
one person's cases apart from another's on a shared machine. They are not a
security boundary.

A turn is in-process end to end except the model call, and one transaction
saves the session change and its events.

Case format: the [clue graph](clue-graph.md).

## Identity and access

Signing in names a profile, creating it if missing; the answer is a cookie
holding its id. Every route picks one of two behaviours:

- **Per profile.** The request manages or plays a session. Without a profile it
  is refused. With one, it gets a context scoped to that profile's sessions and
  events. Nothing underneath catches a query that forgets the scope.
- **No profile.** The request reads only content every profile shares. It is
  served to anyone, and its context holds nothing owned.

**The criterion is ownership, not secrecy.** Does this touch what somebody
owns? If so, per profile. The question is never how sensitive the data
looks: shared content stays shared, and a session stays scoped even when it is
dull. Endpoints declare which they are in
`packages/game-engine/src/endpoints/index.ts`.

## Ripple map

A change in the left column is not finished until the right column agrees.

| Change | Also touches |
|---|---|
| Narrator prompt, contract or context | mock provider and its tests, golden transcripts, eval prompt snapshots, "Narration at play" in `docs/blueprint-generation-flows.md` |
| `packages/shared/src/age-profile.ts` | narrator prompts, the `age_appropriate_turn` judge's built prompt, the per-age tables in `gm_broad`, player-text fields, eval prompt snapshots |
| The definition of "earned" | talk prompt, mock, `gm_roleplay`, `gm_broad`, `gm_spoiler`, `gm_clue_discipline`, `docs/game.md`, `docs/ai-runtime.md` |
| Blueprint schema | context builders and "Narration at play", case judges and the case check, fixtures |
| Event shapes | transcripts, resume, `playedEvents` readers, trace and runtime readers, goldens |
| API contract | `packages/shared/src/mystery-api-contracts.ts` first, web store parsing, testkit fixtures |
