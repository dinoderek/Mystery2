# Quickstart: Action-First Multi-Part Narration

## Goal

Implement parts-only narration contracts, action-first timeout ordering, and exact resume reconstruction from persisted narration events.

## Prerequisites

```bash
cd /Users/dinohughes/Projects/my2/w1
npm install
```

For integration and E2E suites, export local Supabase env values:

```bash
eval "$(npx supabase status -o env | awk -F= '/^[A-Z0-9_]+=/{print "export "$0}')"
```

## Implementation Sequence

1. Update shared gameplay schemas in [/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts](/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts) so:
   - turn responses use `narration_parts`
   - any image shown with narration is attached to the relevant narration part
   - `game-start` and `game-get` return `state` plus `narration_events`
   - top-level current narration summary fields are removed
2. Update persistence so `game_events` stores ordered narration parts as canonical transcript data.
3. Refactor gameplay Edge Functions under [/Users/dinohughes/Projects/my2/w1/supabase/functions](/Users/dinohughes/Projects/my2/w1/supabase/functions) to:
   - emit narration parts for every narration-bearing action
   - append forced accusation framing after final-turn `move`, `search`, and `ask`
   - stop reducing time for `talk` and `end_talk`
4. Update [/Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-get/index.ts) and [/Users/dinohughes/Projects/my2/w1/supabase/functions/game-start/index.ts](/Users/dinohughes/Projects/my2/w1/supabase/functions/game-start/index.ts) to return transcript history separately from gameplay state.
5. Update browser types, store, and narration rendering in [/Users/dinohughes/Projects/my2/w1/web/src/lib](/Users/dinohughes/Projects/my2/w1/web/src/lib) so persisted transcript rendering comes only from `narration_events`, while local system/help/retry lines remain client-only.
6. Update docs (`game`, `accusation-flow`, `testing`, `project-structure`, and `architecture` if needed) to reflect the new timing and transcript rules.

## Targeted Validation During Build

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```

Prefer `npm run test:e2e` for transcript-ordering and contract confidence; keep `npm -w web run test:e2e` only for rendered transcript parity, image rendering, and player-facing recovery messaging.

## Automated Acceptance Targets

These scenarios should be covered by automated unit, integration, API E2E, or browser E2E suites. Manual spot-checking is only for debugging a failing automated scenario.

1. Start a session and confirm the opening transcript renders from persisted narration events rather than a top-level narration field.
2. Use the final remaining turn on `move` and confirm move narration appears before forced accusation framing.
3. Use the final remaining turn on `search` and confirm search narration appears before forced accusation framing.
4. Use the final remaining turn on `ask` and confirm the character answer appears before forced accusation framing.
5. Start and end talk and confirm both actions leave remaining time unchanged.
6. Leave and reopen a mid-game session and confirm narration-area text is identical before and after resume.
7. Leave and reopen a timeout-forced accusation session and confirm the combined transcript is identical before and after resume.
8. Leave and reopen a completed session and confirm transcript text remains identical in read-only view.
9. Confirm image attachments render from the relevant narration parts and do not require image fields on gameplay state.
10. Trigger local help/validation/retry messages and confirm they do not appear in persisted transcript history after reload.

## Required Quality Gates Before Merge

```bash
cd /Users/dinohughes/Projects/my2/w1
eval "$(npx supabase status -o env | awk -F= '/^[A-Z0-9_]+=/{print "export "$0}')"
npm run test:all
```

## Validation Record

- `2026-03-16`: `npm run test:all` passed.
- `2026-03-16`: `npm -w web run check` completed with the existing Svelte accessibility warning on `web/src/lib/components/InputBox.svelte` for `autofocus`.

## Expected Artifacts

- [/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/plan.md](/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/plan.md)
- [/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/research.md](/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/research.md)
- [/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/data-model.md](/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/data-model.md)
- [/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/contracts/action-first-narration.openapi.yaml](/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/contracts/action-first-narration.openapi.yaml)
- [/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/quickstart.md](/Users/dinohughes/Projects/my2/w1/specs/010-action-first-narration/quickstart.md)
