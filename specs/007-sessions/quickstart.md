# Quickstart: Sessions Navigation, Resume, and Completed Logs

## Goal

Implement a session-aware landing flow that lets users start a new game, resume in-progress sessions, and view completed session logs in read-only mode.

## Prerequisites

```bash
cd /Users/dinohughes/Projects/my2/w2
npm install
```

For integration and E2E suites, export local Supabase environment variables:

```bash
eval "$(npx supabase status -o env | awk -F= '/^[A-Z0-9_]+=/{print "export "$0}')"
```

## Implementation Sequence

1. Update shared contracts in `/Users/dinohughes/Projects/my2/w2/packages/shared/src/mystery-api-contracts.ts`:
   - add `SessionSummary` and `SessionCatalogResponse` schemas
   - export corresponding inferred types
2. Implement `/Users/dinohughes/Projects/my2/w2/supabase/functions/game-sessions-list/index.ts`:
   - enforce auth
   - query user-owned `game_sessions`
   - resolve blueprint metadata/title from storage
   - return grouped/sorted `in_progress` and `completed` arrays with `counts`
   - support `GET` and `POST` (store invoke compatibility)
3. Register the function in `/Users/dinohughes/Projects/my2/w2/supabase/config.toml`:
   - add `[functions.game-sessions-list]`
   - set `verify_jwt = false` (shared auth helper validates bearer token in-function)
4. Extend web state/types in `/Users/dinohughes/Projects/my2/w2/web/src/lib/`:
   - catalog loading and caching
   - numeric selection handling
   - disabled/openability rules
5. Update routes:
   - `/Users/dinohughes/Projects/my2/w2/web/src/routes/+page.svelte` for three-option landing menu
   - add `/Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/in-progress/+page.svelte`
   - add `/Users/dinohughes/Projects/my2/w2/web/src/routes/sessions/completed/+page.svelte`
6. Update `/Users/dinohughes/Projects/my2/w2/web/src/routes/session/+page.svelte` and input behavior:
   - keep interactive mode for non-ended sessions
   - enforce read-only prompt behavior for ended sessions loaded via `game-get`
7. Add automated coverage:
   - unit tests for list-state/selection logic
   - integration tests for `game-sessions-list`
   - API E2E for resume and completed viewing
   - Playwright E2E for landing/list navigation and read-only completed viewer
8. Update docs:
   - `/Users/dinohughes/Projects/my2/w2/docs/screen-navigation.md`
   - `/Users/dinohughes/Projects/my2/w2/docs/component-inventory.md`
   - `/Users/dinohughes/Projects/my2/w2/docs/testing.md`
   - plus other core docs only if behavior/contracts meaningfully changed

## Targeted Validation During Build

```bash
cd /Users/dinohughes/Projects/my2/w2
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```

## End-to-End Manual Checks

1. On `/`, verify menu shows:
   - `1. Start a new game`
   - `2. View in-progress games`
   - `3. View completed games`
2. Verify options 2/3 are disabled when respective counts are zero and numeric keys do not navigate.
3. Open in-progress list and confirm rows show mystery title, turns left, and last played sorted newest-first.
4. Resume an in-progress session and confirm gameplay input accepts commands.
5. Open completed list and confirm rows show mystery title, outcome, and last played sorted newest-first.
6. Open a completed session and confirm read-only behavior with only `press any key to go back`.
7. From both list pages, confirm `b` and browser back return to landing.
8. Confirm sessions with missing blueprint metadata appear in list but are disabled for opening.

## Required Quality Gates Before Merge

```bash
cd /Users/dinohughes/Projects/my2/w2
eval "$(npx supabase status -o env | awk -F= '/^[A-Z0-9_]+=/{print "export "$0}')"
npm run test:all
npm -w web run test:e2e
```

## Expected Artifacts

- `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/plan.md`
- `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/research.md`
- `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/data-model.md`
- `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/contracts/sessions.openapi.yaml`
- `/Users/dinohughes/Projects/my2/w2/specs/007-sessions/quickstart.md`
