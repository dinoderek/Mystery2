# {Feature Name} Specification

**Status:** `draft` <!-- draft | ready | in-progress | implemented | abandoned -->
**Branch:** `sdd/{feature-name}`

<!-- Phase 2 output. The single source of truth for implementation. -->
<!-- This document must be precise enough for any agent to execute against. -->

## 1. Overview

<!-- What are we building? 2-3 paragraph summary. -->
<!-- Why are we building it? Link back to the problem. -->

## 2. Reference Architecture

<!-- Patterns chosen from research, with rationale. -->
<!-- How this fits into the existing layer architecture (routes → services → repositories). -->
<!-- Mistakes we're intentionally avoiding and why. -->

## 3. Current State

<!-- Where we're starting from. -->
<!-- Existing code, services, and schemas this builds on. -->
<!-- Files and modules that will be affected. -->

## 4. Design Decisions

<!-- For each major decision: -->
<!--   - What we decided -->
<!--   - What alternatives we considered -->
<!--   - Why we chose this approach -->
<!-- This section prevents future agents from re-litigating settled decisions. -->

### Decision 1: {Title}

**Decided:** ...
**Alternatives considered:** ...
**Rationale:** ...

## 5. Implementation Plan

<!-- Phased approach. What order to build things. -->
<!-- Dependencies between phases. -->
<!-- Rollback strategy if something goes wrong. -->

## 6. Constraints

<!-- Explicit boundaries. -->

### Must

<!-- Non-negotiable requirements. -->

- ...

### Must Not

<!-- Explicit exclusions. -->

- ...

### Technology Boundaries

<!-- Must use X. Cannot use Y. Must stay within existing stack. -->

- ...

### Performance & Security

<!-- Specific, measurable requirements. -->

- ...

## 7. Success Criteria

<!-- Every criterion must be testable. Map to test tiers where possible. -->
<!-- Format: criterion → how to verify → which test tier -->

| Criterion | Verification | Test Tier |
|---|---|---|
| ... | ... | Unit / Component / Integration / E2E |

## 8. Documentation Impact

<!-- Which project docs need updating after implementation? -->

- [ ] `docs/architecture.md` — ...
- [ ] `docs/project-structure.md` — ...
- [ ] `docs/testing.md` — ...
- [ ] `docs/screen-navigation.md` — ... (if UI changes)
- [ ] `docs/component-inventory.md` — ... (if new components)
- [ ] `docs/styling-conventions.md` — ... (if new design patterns)
- [ ] Other: ...

## 9. Implementation Checklist

<!-- Atomic tasks. Each completable in one agent session. Each independently testable. -->

- [ ] Task 1: {Description — what to do, what file(s), what the output is}
- [ ] Task 2: ...
- [ ] Task N: ...

## 10. Open Questions

<!-- Anything still unresolved. These get addressed in Phase 3 (Refinement). -->
