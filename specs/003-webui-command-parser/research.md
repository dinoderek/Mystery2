# Research: Web UI Command Parser

**Feature**: 003-webui-command-parser  
**Date**: 2026-03-06

---

## 1. Existing Parser Architecture

**Decision**: Extend the existing `web/src/lib/domain/parser.ts` module rather than replacing it.

**Rationale**: The current parser already has the right shape — a pure function `parseCommand(input, mode)` returning a discriminated union `ActionCommand`. Pattern-matching on prefixes is the correct approach for a text-adventure. The module needs to grow (more aliases, validation, improved return types) but not be redesigned.

**Alternatives considered**:
- Full NLP parsing: unnecessary complexity; game commands are structured and bounded.
- Grammar-based parser (PEG): overkill for a small command set; harder to extend alias tables.

---

## 2. Target Validation Strategy

**Decision**: Perform target validation inside `parseCommand` (or a thin validation wrapper called immediately after), using the game state passed as a context argument.

**Rationale**: The `GameState` type already provides `locations: { name: string }[]` and `characters: { first_name, last_name, location_name }[]`. These lists are always available when a command is submitted (input is blocked until game state loads). Passing game state context to the parser keeps validation client-side and eliminates backend round trips for invalid targets.

**Key matching rules resolved**:
- Match location: `location.name` (case-insensitive, normalized)
- Match character: `first_name` OR `last_name` (case-insensitive, normalized)
- Target set is scoped by command: movement → locations only; talk/accuse → characters only
- Current-location characters included in movement suggestions (for "where is X?" guidance)

**Alternatives considered**:
- Server-side validation: rejected — spec explicitly requires 100% client-side catch.
- Fuzzy matching: not required; partial prefix match or exact normalized match is sufficient and predictable.

---

## 3. Input Normalization

**Decision**: Normalize input before any parsing — strip leading/trailing whitespace, collapse internal whitespace, lowercase, and strip common punctuation (`!`, `?`, `.`, `,`).

**Rationale**: Avoids spurious failures from user typos and casing differences. Lightweight and predictable. Spec edge case EC2 explicitly requires this.

**Alternatives considered**:
- No normalization: rejected — breaks for common inputs like "Go To  The Kitchen!".

---

## 4. ParseResult Return Type

**Decision**: Replace the current `ActionCommand` type with a richer `ParseResult` discriminated union that includes `valid-command`, `missing-target`, `invalid-target`, `list-request`, `unrecognized`, and `help`.

**Rationale**: The store currently has two paths — "command understood" (call backend) and "unknown command" (push error message). We need more granularity: missing target, invalid target, list request, and unrecognized each require distinct UI responses. Encoding this in the return type makes the store's switch statement the single decision point.

**Alternatives considered**:
- Encoding error state as flags on the existing type: harder to exhaust in TypeScript, murkier intent.
- Throwing exceptions: anti-pattern for expected validation failures.

---

## 5. Alias Tables

**Decision**: Define command aliases as static, declarative tables in `parser.ts` — one array or record per command type listing all recognized prefixes/patterns.

**Rationale**: Simple to read, test, and extend without touching parser logic. Prefixes are checked in order; longest match wins (e.g., "speak with" before "speak").

**Resolved alias sets**:

| Command | Aliases |
|---------|---------|
| move    | go to, move to, travel to, head towards, go, move |
| talk    | talk to, speak to, speak with |
| search  | search, look around, inspect, look |
| end_talk | bye, leave, end, goodbye, see you |
| quit    | quit, exit |
| help    | help |
| locations | locations, where can i go |
| characters | characters, who is here |

---

## 6. Inline Feedback vs. Extended Help

**Decision**: 
- **Inline (unrecognized/error)**: Emit a one-line system message showing only command names (e.g., `Commands: go, talk, search, accuse, help, quit`), with a suffix `(type 'help' for details)`.
- **Extended help**: Triggered by the `help` command, opens the existing `HelpModal.svelte` with full command reference per mode.

**Rationale**: Spec US3 explicitly requires inline feedback that fits in 1–2 lines. The `HelpModal` already exists and is well-structured; it should be extended to include all new aliases.

---

## 7. Retry Logic for Backend Errors

**Decision**: Implement retry logic in `store.svelte.ts` within `submitInput()`. Retry up to 3 times for network-level errors (fetch exceptions) and 5xx HTTP responses. Do NOT retry 4xx responses.

**Rationale**: The architecture doc states UIs should be tolerant of network failures. The Supabase client's `functions.invoke()` throws on network failures. A simple exponential-backoff loop with a 3-attempt cap is the minimum viable approach.

**Retry detection**:
- `error.message` containing network error keywords (e.g., "NetworkError", "fetch failed") → transient
- `status >= 500` on the Supabase response → transient  
- `status >= 400 && status < 500` → permanent, no retry

**Alternatives considered**:
- Third-party retry library: unnecessary for this simple case.
- Retry at the component level: rejected — store is the right boundary for API concerns.

---

## 8. Test Strategy

**Decision**: 
- **Unit tests** for `parser.ts` using Vitest, co-located at `web/src/lib/domain/parser.test.ts`.
- **E2E tests** (Playwright) for each user story's critical paths in `web/e2e/`, extending existing test files.

**Rationale**: Parser logic is pure (no DOM, no network) — ideal for unit tests. UI feedback paths (inline errors, retry indicator, help modal) need E2E coverage.

**Existing E2E coverage**: `input.test.ts`, `help.test.ts`, `narration.test.ts`, `status.test.ts`, `start.test.ts` already exist. New tests will add cases for alias recognition, target validation, inline feedback, and retry behavior.

**Unit test runner**: `npm run test:unit` (Vitest).  
**E2E runner**: `npm run test:e2e` (Playwright via Vitest harness).
