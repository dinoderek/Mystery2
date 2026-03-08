## Actor-Aware Message Rendering (UI + API)

### Summary
Implement explicit speaker metadata for every displayed message block so the UI can render `ActorLabel` before text with actor-specific styling.  
Scope for this change: actor labels + style hooks only. Blueprint-driven actor colors are intentionally deferred.

### Key Implementation Changes
1. **Shared API contract upgrade**
- Extend shared contracts with a `Speaker` model:
  - `kind`: `investigator | narrator | character | system`
  - `key`: stable machine key (for styling hooks; e.g., `you`, `narrator`, `system`, `character:<name-slug>`)
  - `label`: display label (`You`, `Narrator`, `<Character Name>`, `System`)
- Add `speaker` to all turn responses that currently return `narration`.
- Add `speaker` to `history[]` entries in game state (keep existing `actor` field for backward compatibility).
- Add `narration_speaker` to game state for the top-level `narration` field.

2. **Backend speaker population (all game endpoints)**
- Introduce one shared speaker helper in Supabase function shared code to avoid per-endpoint drift.
- Response mapping rules:
  - Player command echoes (client-generated only): `You` (handled in UI store).
  - `game-talk`, `game-ask`, `game-end-talk`: character speaker (using active character).
  - `game-move`, `game-search`, `game-start`, `game-accuse`: narrator speaker.
  - Errors/help/retry text: system speaker (UI-generated).
- Persist speaker metadata into event payload for new events so `game-get` can return stable speaker values.
- In `game-get`, resolve speaker per event using:
  - persisted speaker metadata first,
  - then deterministic fallback heuristics for legacy rows.
- Ensure legacy oddities (like historical `accuse_start` rows) resolve to narrator speaker, not `You`.

3. **UI rendering and style hooks**
- Update message model in the store to include speaker metadata.
- Store behavior:
  - user input lines -> `You`,
  - local help/error/retry feedback -> `System`,
  - backend narration lines -> backend-provided `speaker` (fallback narrator if missing).
- Update terminal message component to render a prefixed actor label before body text, with separate Tailwind class maps for:
  - label styling,
  - body styling,
  - keyed by `speaker.kind` and overridable by `speaker.key`.
- Keep style mapping centralized to enable future per-actor (including per-character) customization without contract changes.

4. **Documentation updates**
- Update core docs loaded for this task to reflect actor-aware messaging:
  - `docs/game.md`: actor semantics in gameplay text.
  - `docs/architecture.md`: API now carries speaker metadata for narration/history.
  - `docs/testing.md`: add actor assertions to API/UI test expectations.
  - `docs/project-structure.md`: brief mention that shared API contracts now include speaker metadata.
- Update `docs/component-inventory.md` to match new `TerminalMessage` props/behavior.

### Test Plan
1. **Unit**
- Update `tests/api/unit/mystery-api-contracts.test.ts` for new `speaker` and `narration_speaker` fields.
- Add/extend UI domain tests for store speaker mapping (`You`/`System`/backend speaker fallback).

2. **Integration (Supabase local)**
- Update endpoint tests (`game-start`, `game-talk`, `game-ask`, `game-end-talk`, `game-search`, `game-move`, `game-accuse`, `game-get`) to assert speaker payload correctness.
- Add one `game-get` legacy fallback case validating speaker inference when older events lack speaker metadata.

3. **E2E (Playwright)**
- Assert actor labels render in narration stream:
  - `You` for typed investigator input,
  - `Narrator` for scene narration,
  - character name for dialogue turns,
  - `System` for help/error/retry messages.

4. **Quality gates**
- Run full gates per project policy:
  - `npm run lint`
  - `npm run typecheck`
  - `npm -w web run check`
  - `npm run test:unit`
  - `npm run test:integration`
  - `npm run test:e2e`
  - `npm -w web run test:e2e`

### Assumptions / Defaults Locked
- `You` applies to player input lines only.
- Talk start and talk end lines are treated as character speech.
- Actor colors from blueprint are **not** included in this change; this ships with app-side actor style mapping + stable keys, enabling a clean follow-up blueprint color feature.


## Changes to the above - TODO
1. Ignore API backwards compatibility
2. Ignore Game Session backwards compatibilty
3. We introduced themeing after the plan above was generated. Please update the plan with tht information
4. Start conversation / End conversation should be Narrator. 
5. Accuse rounds should be between the 'judge character', but I think currently it is the narrator. This is a bug but out of scope. Narrator is fine for now.