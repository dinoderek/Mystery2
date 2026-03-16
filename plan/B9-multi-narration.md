# Timeout Action-First + Parts-Only Narration

## Summary

**Objective**
Replace single-message narration with ordered narration parts across the gameplay API, and change timeout handling so the action that spends the final available time completes before the session is forced into accusation mode.

**Success criteria**
- All narration-bearing responses are parts-only and expose no legacy `narration`, `speaker`, `narration_speaker`, or single-message history fields.
- `game-start` and `game-get` return gameplay state separately from persisted narration events.
- Timeout on `move`, `search`, or `ask` persists the action event first, then the forced accusation-start event, and returns both events’ narration parts in that order.
- Browser resume flows reproduce the narration box text exactly from persisted state, including mid-game, completed, and forced-accusation sessions.

## In Scope

- Replace narration payloads on all narration-bearing endpoints:
  - `game-start`
  - `game-get`
  - `game-move`
  - `game-search`
  - `game-talk`
  - `game-ask`
  - `game-end-talk`
  - `game-accuse`
- Introduce `NarrationPart` as the public narration unit:
  - `{ text: string; speaker: Speaker }`
- Turn-response contract change:
  - remove `narration`
  - remove `speaker`
  - add `narration_parts: NarrationPart[]`
- Read/start payload change:
  - `state` contains gameplay facts only
  - add separate `narration_events` for persisted narration/event history
- Narration event shape change:
  - include `sequence`
  - include `event_type`
  - replace single narration fields with `narration_parts`
- Timeout behavior change:
  - consuming actions: `move`, `search`, `ask`
  - free transitions: `talk`, `end_talk`, accusation start
  - consuming action resolves first, then time is decremented and clamped to `0`, then forced accusation starts if time is exhausted
- `game-get` simplification:
  - remove all legacy narration/speaker fallback inference
  - read only the new parts-based persisted event shape

## Out of Scope

- Any backward compatibility at the API layer
- Any backward compatibility for old `game_events` rows, old session payloads, or old resume behavior
- Data migration or backfill for existing sessions
- Transitional dual-write or compatibility fields
- Richer multi-character scene generation beyond supporting the new parts-capable contract
- UI redesign beyond rendering ordered narration parts and resuming them correctly

## Guardrails

- Backward compatibility is explicitly **not required** on either API or database surfaces.
- A full database reset before rollout is an accepted release assumption and must be treated as the migration strategy.
- Shared Zod contracts in [packages/shared/src/mystery-api-contracts.ts](/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts) remain the single source of truth for the public boundary.
- The append-only event log plus session snapshot model from [docs/architecture.md](/Users/dinohughes/Projects/my2/w1/docs/architecture.md) must be preserved.
- `narration_parts` must be ordered and non-empty wherever narration is returned or persisted.
- Speaker attribution stays on each part; clients must render in stored order and must not infer missing speakers.
- Timeout must never replace the consuming action with forced accusation narration; it must append the forced accusation as a second persisted event.
- `game-start` and `game-get` must not return any top-level “current narration” summary field.
- Client-only help, validation, retry, and local-error messages remain excluded from persisted narration events.
- Observability must log timeout transitions with enough context to diagnose action type, resulting mode, time depletion, and persisted event ordering.

## High-Level Requirements

- Every narration-bearing API response must return `narration_parts`, even when there is only one part.
- `game-start` and `game-get` must return:
  - `state`: gameplay snapshot only
  - `narration_events`: persisted narration/event stream only
- Each `narration_event` must expose:
  - `sequence`
  - `event_type`
  - `narration_parts`
- Timeout ordering must be:
  1. resolve requested action with its normal narration semantics
  2. decrement time and clamp to `0`
  3. if time is `0`, persist a `forced_endgame` accusation-start event
  4. return combined narration parts in action-first order
- Post-timeout session state must be accusation-ready:
  - `mode="accuse"`
  - `time_remaining=0`
  - active talk character cleared when relevant
- `talk` start and `end_talk` must remain narration-bearing but must not spend time.
- Accusation start must remain free whether entered directly or through timeout.
- Resume behavior must be defined entirely by persisted `narration_events`, not by any reconstructed top-level narration field.

## Test Plan

- Unit
  - Update shared contract tests for `NarrationPart`, parts-only turn responses, and split `state` + `narration_events` read/start payloads.
  - Update web/store parsing tests so rendering uses ordered `narration_parts` and persisted `narration_events` only.
- Integration
  - Verify `game-talk` start does not reduce time.
  - Verify `game-end-talk` does not reduce time.
  - Verify timeout on `game-move`, `game-search`, and `game-ask`:
    - action completes
    - time becomes `0`
    - mode becomes `accuse`
    - two events persist in order: action, then `forced_endgame`
    - response returns ordered combined narration parts
  - Verify `game-start` and `game-get` return gameplay state without any legacy narration fields.
  - Verify resumed sessions continue accusation rounds correctly after timeout-forced accuse mode.
- Browser E2E
  - Add at least these 3 resume-parity scenarios, where the assertion is that the narration box text is **identical before and after resume**:
    1. Mid-game resume: start a session, perform narration-producing actions, leave and resume while still mid-investigation, then assert the full rendered narration box text matches exactly pre-resume vs post-resume.
    2. Completed-flow resume: play through accusation to an ended session, capture the full rendered narration box text in the completed view, leave and reopen from completed sessions, then assert exact text equality.
    3. Forced-accusation resume: drive a consuming action that exhausts time and returns the combined action-plus-forced-accuse narration, capture the full rendered narration box text, leave and resume, then assert exact text equality.
  - Update mocks/assertions so browser rendering supports mixed-speaker multi-part responses and resume reconstruction from persisted events only.
- API E2E
  - Update contract assertions to parts-only payloads and `narration_events`-based resume data.
- Quality gates
  - `npm run test:all`

## Assumptions and Defaults

- Full database reset before rollout is acceptable and expected.
- No compatibility behavior will be preserved for old API consumers or old database rows.
- The persisted event list will be named `narration_events`.
- `state` remains in `game-start` and `game-get`, but contains gameplay facts only.
- Normal non-timeout responses may still contain a single narration part; the contract must still allow multiple.
- Resume correctness is defined by exact rendered narration text equality, not just equivalent event counts or speaker metadata.
- Follow-on implementation should update documentation where gameplay timing behavior is now made concrete, especially in [docs/game.md](/Users/dinohughes/Projects/my2/w1/docs/game.md) and [docs/testing.md](/Users/dinohughes/Projects/my2/w1/docs/testing.md).
