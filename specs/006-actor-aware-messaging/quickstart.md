# Quickstart: Actor-Aware Message Rendering

## Goal

Implement and verify speaker-aware narration contracts and UI actor labels with theme-aware speaker-kind styling, narrator overrides (conversation start/end + accusation), and non-persisted local system feedback.

## Prerequisites

```bash
cd /Users/dinohughes/Projects/my2/w3
npm install
```

For integration and E2E suites, export local Supabase env values:

```bash
eval "$(npx supabase status -o env | awk -F= '/^[A-Z0-9_]+=/{print "export "$0}')"
```

## Implementation Sequence

1. Update shared API contract schemas in `/Users/dinohughes/Projects/my2/w3/packages/shared/src/mystery-api-contracts.ts` with `Speaker`, `speaker` response fields, `narration_speaker`, and history speaker metadata.
2. Add shared speaker helper logic under `/Users/dinohughes/Projects/my2/w3/supabase/functions/_shared/` and apply it across game endpoints.
3. Update `/Users/dinohughes/Projects/my2/w3/supabase/functions/game-get/index.ts` to return speaker-enriched state/history.
4. Update UI types/store/components in `/Users/dinohughes/Projects/my2/w3/web/src/lib/` so:
   - user input lines render as `You`
   - local help/error/retry lines render as `System` and are local-only
   - backend narration renders with backend-provided speaker metadata
5. Update theme speaker-kind style mapping and `TerminalMessage` rendering behavior.
6. Update docs (`architecture`, `game`, `testing`, `project-structure`, `component-inventory`) with concise behavior updates.

## Targeted Validation During Build

```bash
cd /Users/dinohughes/Projects/my2/w3
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```

## End-to-End Manual Checks

1. Start a session and confirm opening narration line displays `Narrator`.
2. Enter a command and confirm immediate local line displays `You`.
3. Run `talk to <character>` and confirm response line displays `Narrator`.
4. Ask a talk question and confirm response line displays the active character label.
5. End talk and confirm response line displays `Narrator`.
6. Trigger help/invalid input/retry path and confirm line displays `System`.
7. Reload state via `game-get` and confirm local system lines are absent from persisted history.
8. Run accusation start and rounds and confirm all returned lines display `Narrator`.

## Required Quality Gates Before Merge

```bash
cd /Users/dinohughes/Projects/my2/w3
eval "$(npx supabase status -o env | awk -F= '/^[A-Z0-9_]+=/{print "export "$0}')"
npm run test:all
```

## Expected Artifacts

- `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/plan.md`
- `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/research.md`
- `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/data-model.md`
- `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/contracts/actor-aware-messaging.openapi.yaml`
- `/Users/dinohughes/Projects/my2/w3/specs/006-actor-aware-messaging/quickstart.md`
