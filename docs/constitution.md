# Mystery Game Constitution

## What we are building

We are building a text-based, AI-driven interactive mystery game for young
children. Every change MUST preserve the core player promise documented in
`docs/game.md`: typed investigation, coherent narration, blueprint fidelity,
and a child-friendly experience. Rationale: product changes are easy to blur in
an AI-heavy stack, so the user-facing game contract must stay explicit.

## Core Principles

### I. Documentation First

Before starting any significant task, contributors MUST read
`docs/architecture.md`, `docs/game.md`, `docs/project-structure.md`, and
`docs/testing.md`. When work touches a specialized area, contributors MUST also
load the relevant repo conventions and schema references for that surface area.
These critical documents are not reference-only: contributors MUST carry the
relevant rules, constraints, and project knowledge forward into specifications,
plans, task lists, and implementation summaries. Documentation updates MUST
ship with behavior or workflow changes and MUST keep commands, links, and setup
steps current. Rationale: shared context prevents incorrect implementations and
stale operator guidance, and low-cost project knowledge is only useful if it is
propagated through the delivery workflow.

### II. Test Everything You Build (NON-NEGOTIABLE)

Every change MUST include a concrete test plan aligned with `docs/testing.md`.
Public logic MUST have unit coverage; the engine's endpoints, profile
resolution, session ownership, and content loading MUST have integration
coverage against a running server; critical user journeys, API-backed flows,
and visual flows MUST have E2E or browser coverage as appropriate. Documentation-only changes MAY skip code tests only when they
do not alter runtime code, tooling, migrations, tests, or environment
contracts. Rationale: the game is one process over a real database and real files, and
regressions at those boundaries are only visible when each is exercised.

### III. Run Quality Gates

Before finalizing any non-documentation change, contributors MUST run the
quality gates defined in `docs/testing.md`: linting/formatting, type checking,
unit tests, integration tests, E2E tests, and documentation sync. For
documentation-only changes, contributors MUST still validate command accuracy,
cross-document consistency, and link/path correctness before completion.
Rationale: one consistent release bar is simpler to enforce than per-author
exceptions.

### IV. Architecture & Security Constraints

Changes MUST preserve the approved architecture in `docs/architecture.md`: the
game runs as **one local Node process** — a SvelteKit server that serves both
the SPA and its `/api`, over SQLite and the filesystem, with server-side AI
calls to OpenRouter. Three constraints follow and MUST hold:

1. **Secrets stay out of the browser.** The OpenRouter key is read by the
   server from the environment and never reaches the client.
2. **Ownership is enforced in the engine's repositories.** Every session and
   event query MUST be scoped to the requesting profile. There is no database
   layer underneath to catch a query that forgets.
3. **The engine does not know how it is hosted.** Handlers reach the outside
   world only through `EngineContext`; anything that reaches past it — a file
   path, a driver, an HTTP detail — belongs in an adapter.

Reintroducing a hosted backend, a container dependency, or a build step between
the source and the running game is a deviation and MUST be recorded in the
implementation plan before work begins. Rationale: the whole value of this
architecture is that it is small enough to hold in your head and runs with one
command; drift back toward a platform is expensive to undo, and a leaked key or
an unscoped query has no second line of defence.

### V. Context-Specific Conventions

Contributors MUST load the repo guidance that governs the surface area they are
editing before implementation. This includes `docs/styling-conventions.md` for
SvelteKit styling/theme work, `docs/component-inventory.md` for UI reuse,
`docs/screen-navigation.md` for routing/page architecture,
`docs/backend-conventions.md` for the engine, API contracts, and database
changes, and `packages/shared/src/blueprint-schema-v2.ts` for
structural mystery data-model changes. Plans, specs, and tasks MUST reflect
those conventions instead of inventing parallel patterns. Rationale: shared
conventions keep generated work compatible with the existing repo structure and
review expectations.

### VI. Observability and Logging

Every materially changed feature MUST define how failures are surfaced and
debugged. Errors MUST be logged or otherwise captured at least once with enough
context to diagnose the failing request, session, or blueprint state, and
user-facing flows MUST not silently swallow failures. When work introduces new
operator workflows or debugging steps, the relevant docs MUST be updated in the
same change. Rationale: AI-backed gameplay is
non-deterministic, and a bad turn is only diagnosable from what the request
logged while it happened.

## Development Workflow

- All work MUST comply with this Constitution. `AGENTS.md` MAY add operational
  workflow details for agents, but it MUST not redefine or weaken these rules.
- Plans, specs, and task lists MUST record how documentation, testing,
  architecture, conventions, and observability are satisfied.
- Critical document knowledge MUST be reflected through the Constitution ->
  Spec -> Plan -> Task flow, with `AGENTS.md` reinforcing the same reading and
  update expectations during agent execution.
- Changes MUST be summarized clearly for user review, including any skipped
  gates or deferred follow-up.
- Complexity MUST be justified and documented explicitly before deviating from
  standard architectural patterns.

## Governance

This Constitution supersedes conflicting local practice documents. Amendments
MUST include the updated constitution text, a Sync Impact Report, a semantic
version decision, and same-change updates to affected templates or guidance
files. Versioning policy is semantic: MAJOR for backward-incompatible
governance changes or principle removal/redefinition, MINOR for new principles
or materially expanded guidance, and PATCH for clarifications or wording-only
refinements. Compliance reviews for plans, specs, task lists, pull requests,
and final delivery summaries MUST verify documentation, testing, quality gates,
architecture/security constraints, context-specific conventions, and
observability against this Constitution. If `AGENTS.md` or any other local
guidance conflicts with this Constitution, this Constitution wins. Use
`AGENTS.md` for agent workflow details and `docs/` for project/runtime
guidance.

**Version**: 2.0.0 | **Ratified**: 2026-03-05 | **Last Amended**: 2026-08-29
