# Research: Actor-Aware Message Rendering

**Feature**: `006-actor-aware-messaging`  
**Date**: 2026-03-09  
**Phase**: 0 - Outline & Research

## Research Task Queue

- Research the shared API speaker contract shape for all narration-returning endpoints.
- Research speaker assignment rules per game action, including narrator overrides for conversation start/end and accusation rounds.
- Research persistence boundaries for backend history vs client-only system feedback.
- Research theme-aware message styling strategy using generic character styling.
- Research test coverage patterns for actor attribution across unit, integration, API E2E, and browser E2E.
- Research documentation update scope to keep core docs lean while reflecting the behavior change.

## 1. Shared Speaker Contract

**Decision**: Use one `Speaker` model at the shared API boundary with fields `kind`, `key`, and `label`, and include it in all narration-bearing responses plus `state.narration_speaker` and each `state.history[]` entry.

**Rationale**: The feature’s core requirement is explicit speaker metadata for every displayed message block. A single normalized model avoids endpoint drift and keeps UI rendering deterministic.

**Alternatives considered**:
- Keep legacy `actor` only: rejected because it is too coarse and cannot represent narrator vs character distinctions reliably.
- Add endpoint-specific ad hoc speaker fields: rejected due duplication and schema drift risk.

## 2. Speaker Mapping Rules by Action

**Decision**: Apply deterministic mapping rules: `You` for player input lines (client-generated), `System` for local help/error/retry lines, `Narrator` for start/move/search/accuse plus conversation start/end, and `Character` for talk-question responses only.

**Rationale**: This exactly matches accepted scope updates and fixes ambiguity from previous plans.

**Alternatives considered**:
- Character speaker for talk start/end: rejected by explicit feature correction.
- Judge-character speaker during accuse rounds now: rejected as out-of-scope; retained as narrator for this release.

## 3. History Persistence Boundary

**Decision**: Persist only backend narration events with speaker metadata; do not persist client-generated system feedback (help/validation/retry/local errors) to backend history.

**Rationale**: Local system lines are UX feedback, not canonical game state. Keeping them local prevents history pollution and preserves deterministic server session history.

**Alternatives considered**:
- Persist local system lines as synthetic events: rejected due noisy history and backend/client responsibility mixing.
- Drop local system messaging entirely: rejected because inline guidance and retry UX are required.

## 4. Backward Compatibility Handling

**Decision**: Treat the upgraded speaker contract and session-state shape as the required format for this feature with no compatibility requirement for older payload/session formats.

**Rationale**: The feature explicitly removes compatibility obligations, allowing a cleaner contract without legacy adapter logic.

**Alternatives considered**:
- Dual-shape support (`actor` + `speaker`) indefinitely: rejected due added complexity and limited feature value.
- Migration fallback heuristics for historical rows: rejected due explicit scope decision to ignore session backward compatibility.

## 5. Theme-Aware Styling Strategy

**Decision**: Render label and body styles from theme mappings keyed by speaker kind, with one shared generic style for all character speakers.

**Rationale**: This aligns with current scope and avoids premature per-character styling complexity while staying compatible with theme switching.

**Alternatives considered**:
- Per-character style overrides keyed by `speaker.key`: rejected for this release after review feedback.
- Hard-coded non-theme colors in component markup: rejected because theming must remain the source of truth.

## 6. Test Strategy

**Decision**: Expand tests at four levels: unit (shared schemas + store mapping), integration (endpoint speaker payload assertions), API E2E (full flow speaker checks), and web Playwright E2E (rendered actor labels + system non-persistence behavior).

**Rationale**: Speaker attribution is cross-layer behavior; single-tier tests are insufficient to prove correctness.

**Alternatives considered**:
- Integration-only assertions: rejected because UI label rendering and local-system behavior would be unverified.
- Browser-only assertions: rejected because contract regressions could be masked by frontend fallback logic.

## 7. Documentation Update Scope

**Decision**: Update existing core docs (`architecture`, `game`, `testing`, `project-structure`) plus `component-inventory` with concise behavior changes; keep deep implementation detail in feature artifacts and implementation PR discussion.

**Rationale**: Constitution and AGENTS require doc sync while keeping docs lean.

**Alternatives considered**:
- Update only feature spec docs: rejected because core docs would become stale.
- Add a large new dedicated doc now: rejected because scope does not require additional standalone documentation yet.
