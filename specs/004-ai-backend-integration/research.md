# Research: AI Backend Integration for Narrative Turns

**Feature**: `004-ai-backend-integration`  
**Date**: 2026-03-06  
**Phase**: 0 - Outline & Research

## Research Task Queue

- Research OpenRouter integration pattern for Supabase Edge Functions with secure environment-based model selection.
- Research output-contract enforcement for AI responses before state mutation.
- Research context partitioning to prevent ground-truth leakage in non-accusation flows.
- Research two-stage accusation interaction pattern that supports iterative judgment rounds.
- Research live-AI regression strategy using deterministic investigator scripts across two model profiles.
- Research failure-handling pattern aligning with client retry ownership and non-finalized turns.

## 1. AI Provider Integration Pattern

**Decision**: Implement an `OpenRouterProvider` inside `supabase/functions/_shared/ai-provider.ts` and route provider/model selection via environment-backed execution profiles (`default`, `cost_control`). Keep `MockAIProvider` for deterministic baseline tests.

**Rationale**: This preserves existing abstraction boundaries, keeps secrets server-side, and allows test/runtime profile switching without changing endpoint logic.

**Alternatives considered**:
- Call OpenRouter directly from each endpoint: rejected due duplication and inconsistent safeguards.
- Replace mock-only provider entirely: rejected because deterministic default test suites are required.

## 2. Output Contract Enforcement

**Decision**: Define role-specific output Zod schemas in a shared backend module and validate every AI response before game-state updates or event commits.

**Rationale**: FR-007 and FR-014 require contract-valid responses and prevention of invalid turn finalization. Schema enforcement provides a single hard gate for correctness.

**Alternatives considered**:
- Prompt-only response shaping without validation: rejected; too brittle for live model variance.
- Free-form text parsing with heuristics: rejected due ambiguity and regression risk.

## 3. Ground-Truth Access Boundary

**Decision**: Non-accusation roles (`talk-start`, `talk-conversation`, `talk-end`, `search`) receive only scoped context; full ground truth is permitted only for the accusation-judge role after accusation begins.

**Rationale**: This applies the accepted clarification directly and minimizes accidental spoiler leakage.

**Alternatives considered**:
- Share full ground truth with all roles and rely on prompt discipline: rejected for leakage risk.
- Share partial hidden hints to all roles: rejected due unnecessary exposure complexity.

## 4. Accusation Flow Contract

**Decision**: Keep the existing `game-accuse` endpoint and implement two-stage accusation behavior inside backend AI orchestration (scene framing + judgment progression) with only minimal, backward-compatible payload/response changes if needed.

**Rationale**: This matches FR-005 while respecting the existing backend API surface and avoiding disruptive endpoint churn.

**Alternatives considered**:
- Add a new `game-accuse-reasoning` endpoint: rejected for this phase because the primary goal is backend↔AI contract hardening with minor API changes.
- Move accusation rounds to client-only logic: rejected; server must own authoritative judgment.

## 5. AI Failure and Retry Ownership

**Decision**: Keep retry ownership in the client/store. Backend responses for AI timeout/invalid output are explicit and retriable; failed attempts do not finalize turn outcomes or irreversible mode transitions.

**Rationale**: Aligns with accepted clarification and existing client retry architecture (`store.retry.ts`) while preserving state consistency.

**Alternatives considered**:
- Automatic server-side retries only: rejected; hides control and complicates observability.
- Consume turns on any provider failure: rejected by clarification and user-experience goals.

## 6. Live-AI Test Strategy

**Decision**: Add dedicated opt-in live suites (integration + API E2E, optional browser E2E) that run a predefined case and investigator script in both `default` and `cost_control` profiles. Exclude these suites from `npm run test:all`.

**Rationale**: Provides real-model regression signal while controlling cost, brittleness, and CI determinism.

**Alternatives considered**:
- Add live suites to default quality gate: rejected due cost and non-determinism.
- Mock-only validation: rejected because it misses provider-specific behavior drift.

## 7. Shared Boundary Schema Location

**Decision**: Add `packages/shared/src/mystery-api-contracts.ts` as the public API boundary source-of-truth and keep blueprint ground-truth schema private in `supabase/functions/_shared/blueprints/blueprint-schema.ts`.

**Rationale**: Matches backend conventions: public UI/backend contract in shared schemas, private truth model confined to backend.

**Alternatives considered**:
- Keep public contracts in Edge Function files only: rejected due duplication and drift risk.
- Expose blueprint schema directly to frontend: rejected for secrecy and narrative integrity.

## 8. Documentation Update Scope

**Decision**: Update `docs/game.md`, `docs/testing.md`, and AI-related blueprint guidance docs as part of implementation, and add a dedicated `docs/ai-runtime.md` if prompt-role/runtime rules grow beyond concise updates.

**Rationale**: Keeps core docs lean while reserving a focused place for complex AI runtime constraints.

**Alternatives considered**:
- Put all AI runtime detail in core docs only: rejected due bloat risk.
- Skip docs until after implementation: rejected by constitution and AGENTS requirements.
