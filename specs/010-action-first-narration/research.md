# Research: Action-First Multi-Part Narration

**Feature**: `010-action-first-narration`  
**Date**: 2026-03-16  
**Phase**: 0 - Outline & Research

## Research Task Queue

- Research the canonical public contract for ordered narration parts across gameplay endpoints.
- Research the persistence model for multi-part narration in the existing append-only `game_events` log.
- Research timeout sequencing rules that preserve the final time-consuming action before forced accusation.
- Research resume rendering rules that guarantee exact narration parity from persisted state only.
- Research observability and testing patterns for narration ordering and resume failures.
- Research documentation updates required to make gameplay timing and narration behavior explicit.

## 1. Public Narration Contract

**Decision**: Introduce `NarrationPart` as the only public narration unit for gameplay responses and persisted narration history, allow each part to carry an optional `image_id`, and split session load/start payloads into `state` plus `narration_events`.

**Rationale**: The current boundary mixes current narration summaries with persisted history and assumes one speaker-bearing string per response. The feature requires ordered multi-speaker sequences, exact resume parity, and no top-level narration inference. A single canonical part model plus explicit `narration_events` removes ambiguity, and part-level image attachment keeps media coupled to the transcript line that introduced it.

**Alternatives considered**:
- Keep single-string narration and let the client split or decorate it: rejected because multi-speaker order and exact persistence cannot be represented.
- Keep `state.history` plus top-level `state.narration`: rejected because it preserves the duplication and fallback behavior the feature is removing.

## 2. Event Persistence Shape

**Decision**: Persist ordered narration parts directly on each `game_events` row in a dedicated `narration_parts` field, keep `payload` for non-rendered action metadata, and stop treating `payload.speaker` or `game_events.narration` as canonical transcript sources.

**Rationale**: The repo’s architecture explicitly uses an append-only event log plus session snapshot. The cleanest way to support ordered multi-part transcript replay is to make the event row itself carry the exact parts the player saw, including any image attachment on a part, while leaving `payload` free for endpoint-specific metadata such as follow-up prompts.

**Alternatives considered**:
- Store narration parts only inside `payload`: rejected because transcript data becomes harder to validate and easier to mix with endpoint-private metadata.
- Create a child table for narration parts: rejected because narration parts are bounded per event and the feature does not need cross-event querying granular enough to justify a second event-history table.

## 3. Timeout Ordering Rules

**Decision**: For `move`, `search`, and `ask`, resolve and persist the requested action first, then decrement remaining time and clamp to zero, then append a second `forced_endgame` narration event if time is exhausted, and only then leave the session in accusation mode. `talk`, `end_talk`, and accusation entry become non-time-consuming.

**Rationale**: This matches the spec’s fairness goal and fixes the current behavior where timeout can replace the action result instead of following it. Making talk entry/exit free also resolves the ambiguity left open in `docs/game.md` and aligns timeout handling with the accepted scope.

**Alternatives considered**:
- Keep current timeout behavior that replaces the action result when time runs out: rejected because it loses player-visible causality.
- Continue charging time for `talk`: rejected because this feature explicitly narrows time consumption to move, search, and ask.

## 4. Resume Reconstruction Strategy

**Decision**: Treat persisted `narration_events` as the sole backend source for rebuilding the narration box. The web store should flatten `narration_events[].narration_parts[]` into renderable lines in stored order, including any attached images on those parts, and never reconstruct transcript lines from top-level `state.narration` fields.

**Rationale**: Exact text parity on resume is only reliable if the browser uses the persisted transcript itself rather than a mix of history, fallback summaries, and response-time shortcuts. This also removes the current `game-get`/store inference path.

**Alternatives considered**:
- Keep client-side fallback insertion when history is empty: rejected because it can invent transcript lines not backed by persisted events.
- Reconstruct transcript from endpoint-specific response types on the client: rejected because resume would no longer be driven by canonical stored state.

## 5. Observability Strategy

**Decision**: Log timeout transitions and narration-event persistence with session ID, endpoint, event order, event type, part count, before/after time values, resulting mode, and whether a forced accusation event was appended. Surface load/resume failures to the player with retry guidance and retain request/session context in server logs.

**Rationale**: The main failure modes here are ordering bugs and replay mismatches. Those are hard to diagnose unless logs make the intended sequence and persisted output explicit.

**Alternatives considered**:
- Rely on generic request-error logging only: rejected because it will not explain transcript ordering or session replay defects.
- Suppress load errors and show partial history: rejected because silent degradation would hide data-loss bugs from players and operators.

## 6. Testing Strategy

**Decision**: Cover the feature at four levels: shared-schema/store unit tests, backend integration tests for event persistence and timing rules, API E2E for contract shape, and browser E2E for exact narration parity across mid-game, forced-accusation, and completed-session resumes.

**Rationale**: This behavior crosses the shared contract, Edge Functions, persistence layer, and browser rendering. A single test tier would miss regressions in one or more layers.

**Alternatives considered**:
- Integration-only coverage: rejected because exact browser transcript parity would remain unproven.
- Browser-only coverage: rejected because backend ordering mistakes could be hidden by frontend fallback behavior.

## 7. Documentation Scope

**Decision**: Update `docs/game.md`, `docs/accusation-flow.md`, `docs/testing.md`, and `docs/project-structure.md` alongside the implementation; update `docs/architecture.md` only if the contract/persistence description needs a concise wording change.

**Rationale**: The Constitution requires doc sync for behavior changes, and this feature makes the gameplay time model more concrete while also changing the shape of persisted narration history.

**Alternatives considered**:
- Leave the timing clarification only in the feature spec: rejected because core gameplay docs would remain ambiguous.
- Create a new standalone narration doc immediately: rejected because the existing docs can absorb the change without becoming cluttered.
