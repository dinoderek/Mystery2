# Timeout Action-First + Parts-Only Narration (DB Reset Assumed)

## Summary
Implement timeout behavior and move all narration-bearing API responses to parts-only narration.
With a database reset, no backward compatibility is needed in `game-get`.

## API / Interface Changes
- Replace single narration fields with parts-only everywhere narration is returned.
- Turn responses:
  - remove `narration` and `speaker`
  - add `narration_parts: { text: string; speaker: Speaker }[]`
- `game-start` / `game-get` state:
  - replace `narration` + `narration_speaker` with `narration_parts`
- `history[]` entries:
  - replace `narration` + `speaker` with `narration_parts`
- Apply to all narration-bearing endpoints:
  - `game-start`
  - `game-get`
  - `game-move`
  - `game-search`
  - `game-talk`
  - `game-ask`
  - `game-end-talk`
  - `game-accuse`
- No compatibility fields retained.

## Implementation Changes
- Time-cost rules:
  - Free mode transitions:
    - `talk` start
    - `end_talk`
    - `accuse` start
  - Consuming actions:
    - `move`
    - `search`
    - `ask`
- Timeout ordering:
  - Execute consuming action first.
  - Decrement time and clamp at `0`.
  - If post-action time is `<= 0`, transition to `mode='accuse'` after action completion.
- Timeout persistence and response:
  - Persist two events in order:
    1. normal action event (`move|search|ask`)
    2. `forced_endgame` event (accusation-start)
  - Timeout response `narration_parts` order:
    1. action part
    2. forced-accuse part
- `game-get` simplification:
  - remove legacy fallback inference for speaker/narration
  - read only new parts-based event/state shape

## Test Plan
- Update shared contract unit tests for parts-only schemas.
- Update web store/unit tests to parse and apply `narration_parts`.
- Integration tests:
  - `game-talk` start does not reduce time
  - `game-end-talk` does not reduce time
  - timeout in `game-move/search/ask`:
    - action executes
    - time becomes `0`
    - mode becomes `accuse`
    - two events persisted in order
  - timeout responses contain two ordered parts with mixed attribution
  - `game-get` returns parts-only state/history
- Update API E2E and web E2E mocks/assertions to parts-only responses.
- Run quality gates:
  - `npm run test:all`

## Assumptions
- Database is reset before rollout.
- No backward compatibility required for old `game_events` payloads or legacy `game-get` shape.
- Breaking FE/BE response contract change is intentional.
