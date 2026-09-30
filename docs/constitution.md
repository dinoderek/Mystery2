# Mystery Game Constitution

A text-based, AI-narrated mystery game for young children. Every change keeps
the player promise in `docs/game.md`: typed investigation, coherent narration,
fidelity to the blueprint, and a child-friendly experience.

This document wins over any other guidance in the repo. `AGENTS.md` adds how
agents work; it may not weaken anything here.

## I. Documentation ships with the change

Read the core docs listed in `AGENTS.md` before significant work, and the
area docs it names for the surface you touch. A change to behaviour, workflow,
commands or setup updates the doc that owns that topic in the same change. Each
topic has one owning doc; others link to it rather than restate it.

## II. Test what you build (non-negotiable)

Every change carries tests at the boundary it affects, per `docs/testing.md`:
unit for logic, integration against a running server for endpoints, ownership,
profiles and content loading, E2E for journeys. The game is one process over a
real database and real files; regressions at those boundaries show only when
each is exercised.

## III. Run the gate

A change is finished when `npm test` passes. Documentation-only changes still
validate commands, paths and links, and pass the curated-docs check when they
touch a source it tracks.

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

Use the conventions of the area you are editing instead of inventing parallel
ones. Complexity that departs from them is justified in the change.

## VI. Failures are visible

A changed feature logs its failures once, with enough context — request,
session, blueprint — to diagnose them, and no user-facing flow swallows an
error silently. AI turns are non-deterministic; what was logged at the time is
the only way to explain a bad one.

---

**Version**: 3.0.0 | **Ratified**: 2026-03-05 | **Last Amended**: 2026-09-30
