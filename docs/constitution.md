# Mystery Game Constitution

A text-based, AI-narrated mystery game for young children. Every change keeps
the player promise in `docs/game.md`: typed investigation, coherent narration,
fidelity to the blueprint, and a child-friendly experience.

This document wins over any other guidance. `AGENTS.md` adds how
agents work; it may not weaken anything here.

## I. Documentation ships with the change

Before significant work, read the core docs `AGENTS.md` lists, and the area
docs it names for what you touch. A change to behaviour, workflow, commands or setup updates the owning doc
in the same change. Each topic has one owner; others link to it.

## II. Test what you build (non-negotiable)

Every change carries tests at the boundary it affects, per `docs/testing.md`:
unit for logic, integration against a running server for endpoints, ownership,
profiles and content, E2E for journeys. The game is one process over a real
database and files; regressions there show only when each boundary is
exercised.

## III. Run the gate

A change is finished when `npm test` passes. Documentation-only changes still
pass the gate's doc checks (`check:curated-docs`, `check:doc-refs`) and have
their commands checked by hand.

## IV. Keep the architecture small

The game runs as one local Node process — SvelteKit serving the SPA and its
`/api`, over SQLite and the filesystem (`docs/architecture.md`). Three
constraints hold:

1. **Secrets stay on the server.** An AI key never reaches the browser.
2. **Ownership is enforced in the engine's repositories.** Every session and
   event query is scoped to the requesting profile; nothing underneath catches
   one that forgets. An endpoint runs as a profile only when it manages or plays
   a session; one over shared content must not require a profile.
3. **The engine does not know how it is hosted.** Handlers reach the outside
   world only through `EngineContext`.

Reintroducing a hosted backend, a container, or a build step between source and
running game is a deviation, and is agreed before work starts.

## V. Follow the existing conventions

Follow the conventions of the area you edit instead of inventing parallel ones,
and justify any departure in the change.

## VI. Failures are visible

A changed feature logs its failures once, with enough context — request,
session, blueprint — to diagnose them, and no user-facing flow swallows an
error silently. AI turns are non-deterministic; only what was logged explains a bad
one.

---

**Version**: 3.0.1 | **Ratified**: 2026-03-05 | **Last Amended**: 2026-09-30
