# Implementation Plan: Web UI Command Parser

**Branch**: `003-webui-command-parser` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)

## Summary

Improve the Web UI command parser to intelligently recognize aliases for all command types, validate targets client-side before any backend call, show clear inline feedback for invalid/missing targets and unrecognized commands, expose location/character list commands, separate brief inline help from a detailed help modal, and add retry logic for transient backend errors. All logic lives in the existing `web/src/lib/domain/` module. No backend changes are required.

## Technical Context

**Language/Version**: TypeScript 5.x (SvelteKit 2 / Svelte 5)  
**Primary Dependencies**: SvelteKit (static), Tailwind CSS, Playwright (E2E), Vitest (unit)  
**Storage**: N/A (client-side only)  
**Testing**: Playwright E2E (`npm -w web run test:e2e`), Vitest unit (new: `npm -w web run test:unit`)  
**Target Platform**: Browser (static SvelteKit build, Cloudflare Pages)  
**Project Type**: Web application (static UI + Supabase Edge Functions)  
**Performance Goals**: Command parsing is synchronous and sub-millisecond; no measurable performance concern  
**Constraints**: No secrets in the browser; no SSR; no backend round trips for validation  
**Scale/Scope**: Single-file domain module (`parser.ts`) + store extension + 1–2 component tweaks

## Constitution Check

- [x] Documentation reviewed and lean — AGENTS.md, architecture.md, testing.md, styling-conventions.md, component-inventory.md all loaded
- [x] Testing strategy includes E2E (Playwright, existing `web/e2e/`) and Unit (new Vitest in `web/src/lib/domain/`)
- [x] Quality gates runnable — `npm run test:all` covers lint + typecheck + svelte-check + unit + integration + E2E
- [x] Static UI + Supabase backend constraints respected — all new logic is client-side; retry is in the store
- [x] Context-specific conventions applied — Tailwind CSS for any UI additions; no CSS modules; existing component patterns followed

**Post-design re-check**: Plan respects all constraints. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-webui-command-parser/
├── plan.md              # This file
├── research.md          ✅ written
├── data-model.md        ✅ written
├── contracts/
│   └── parser-contract.md  ✅ written
├── checklists/
│   └── requirements.md  ✅ written
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (changed files)

```text
web/
├── src/
│   └── lib/
│       ├── domain/
│       │   ├── parser.ts          [MODIFY] - new ParseResult type, alias tables, normalization, validation
│       │   ├── parser.test.ts     [NEW]    - Vitest unit tests for all ParseResult branches
│       │   └── store.svelte.ts    [MODIFY] - ParseResult switch, retry logic, inline feedback messages
│       └── components/
│           └── HelpModal.svelte   [MODIFY] - extend content with all new aliases
├── e2e/
│   ├── input.test.ts              [MODIFY] - add alias, target validation, inline feedback tests
│   └── help.test.ts               [MODIFY] - add brief-inline vs extended-help test cases
└── package.json                   [MODIFY] - update test:unit script to run Vitest on domain/
```

## Proposed Changes

---

### Domain: Parser (`web/src/lib/domain/parser.ts`)

**Summary**: Full rewrite of `parser.ts` to introduce input normalization, a mode-aware alias table, target validation, and a richer `ParseResult` return type.

#### [MODIFY] [parser.ts](file:///Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.ts)

- Add `ParseContext` interface (receives `locations`, `characters`, `currentLocation` from game state)
- Add `ParseResult` discriminated union replacing current `ActionCommand` type (keeping `ActionCommand` for the `valid` branch payload)
- Add `AliasMap` — static, ordered arrays of prefix strings per command type
- Add `normalize(input)` — trim, lowercase, collapse whitespace, strip trailing punctuation
- Rewrite `parseCommand(raw, mode, context)` to:
  1. Normalize input
  2. Match aliases by longest-prefix-first in mode order
  3. For commands requiring a target: validate against context; return `missing-target` or `invalid-target` as needed
  4. For `locations`/`characters` list commands: resolve and return `ListRequest` with items populated from context
  5. Return `HelpRequest` or `quit` (new) as typed results

#### [NEW] [parser.test.ts](file:///Users/dinohughes/Projects/my2/w1/web/src/lib/domain/parser.test.ts)

Vitest unit tests covering:
- Normalization edge cases (case, extra spaces, punctuation)
- All alias prefixes for each command type
- Valid target matching (first name, last name, location name)
- `missing-target` (bare `go`, bare `talk to`)
- `invalid-target` with correct suggestions list
- `unrecognized` with correct mode-specific hint string
- `list` command (locations + characters)
- Mode-aware command set (e.g., movement alias in talk mode → `ask`)

---

### Domain: Store (`web/src/lib/domain/store.svelte.ts`)

**Summary**: Update `submitInput` to switch on the new `ParseResult` type. Add retry logic for transient backend errors. Add `isRetrying` reactive state.

#### [MODIFY] [store.svelte.ts](file:///Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts)

- Add `isRetrying = $state(false)` and `retryCount = $state(0)` 
- Update `submitInput` call: `parseCommand(input, mode, { locations, characters, currentLocation })` passing current game state context
- Replace the `default` branch with a full `ParseResult` switch:
  - `valid` → existing backend call logic (moved here)
  - `missing-target` / `invalid-target` → push inline feedback message + suggestions to history; no backend call
  - `list` → format and push location/character list to history; no backend call
  - `unrecognized` → push brief command list hint to history; no backend call
  - `help` → set `showHelp = true` (existing behavior)
  - `quit` → handle session exit (existing or new)
- Wrap backend call in retry loop (max 3 attempts):
  - Catch network errors or `5xx` responses → set `isRetrying = true`, wait with exponential backoff, retry
  - On `4xx` → surface error immediately, no retry
  - After max retries → push error message, offer manual retry via history entry

---

### Component: HelpModal (`web/src/lib/components/HelpModal.svelte`)

**Summary**: Update the COMMAND REFERENCE modal content to include all supported aliases and the new `locations`, `characters`, `quit` commands.

#### [MODIFY] [HelpModal.svelte](file:///Users/dinohughes/Projects/my2/w1/web/src/lib/components/HelpModal.svelte)

- Add aliases to each command entry (e.g., "move to / go to / travel to / head towards [location]")
- Add `search` aliases ("look around, inspect")
- Add `characters` / `locations` list commands
- Add `quit` / `exit` to General section
- Add `end_talk` aliases to Talk Mode section

---

### Web package.json

#### [MODIFY] [package.json](file:///Users/dinohughes/Projects/my2/w1/web/package.json)

- Update `test:unit` script from `echo 'No unit tests yet'` to `vitest run src/lib/domain`
- Add `vitest` as dev dependency

---

### E2E Tests

#### [MODIFY] [input.test.ts](file:///Users/dinohughes/Projects/my2/w1/web/e2e/input.test.ts)

New test cases:
- Alias recognition: `travel to kitchen` resolves to a move command
- Missing target: `go` alone → inline feedback with location list visible in narration
- Invalid target: `go to zyx` → inline feedback with valid targets shown
- `locations` command → location list appears in narration
- `characters` command → character list appears in narration
- Unrecognized command → brief command list shown inline

#### [MODIFY] [help.test.ts](file:///Users/dinohughes/Projects/my2/w1/web/e2e/help.test.ts)

New test cases:
- Unrecognized command shows brief inline hint (not the full modal)
- `help` command opens the full `HelpModal` with COMMAND REFERENCE heading

---

## Verification Plan

### Automated Tests

**Unit tests** (pure parser logic, no browser required):

```bash
cd /Users/dinohughes/Projects/my2/w1
npm -w web run test:unit
```

Expected: all Vitest tests in `web/src/lib/domain/parser.test.ts` pass.

**Svelte type checking**:

```bash
cd /Users/dinohughes/Projects/my2/w1
npm -w web run check
```

Expected: no svelte-check errors.

**Type checking (root)**:

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run typecheck
```

**Linting**:

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run lint
```

**E2E tests** (requires Supabase running + web dev server):

```bash
cd /Users/dinohughes/Projects/my2/w1
npm -w web run test:e2e
```

Expected: all existing Playwright tests still pass, plus new cases for alias recognition, target validation, inline feedback, and list commands.

**Full quality gate**:

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run test:all
```

### Manual Verification

1. Start dev server: `npm run dev` from repo root
2. Open the game in the browser; start a session
3. In explore mode, type `travel to <valid location>` → command should succeed (same as `go to`)
4. In explore mode, type `go` alone → inline message showing available locations should appear in the narration box
5. In explore mode, type `go to zyx` → inline message listing valid locations should appear
6. In explore mode, type `locations` → narration should show a list of locations with characters at each
7. In explore mode, type `characters` → narration should show character list
8. In explore mode, type `jump over fence` → brief command list hint should appear inline (not the modal)
9. Type `help` → HelpModal should appear with updated content including all aliases
10. In talk mode, type `go to kitchen` → should be treated as a conversational question (sent to `game-ask`)
11. Type `speak with <character name>` → should initiate a talk command (same as `talk to`)
