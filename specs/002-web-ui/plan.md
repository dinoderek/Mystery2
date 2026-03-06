# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

## Summary

Initialize the static SvelteKit web application and implement the core UI screens for game blueprint selection and the active gameplay session. The UI will communicate with the Supabase backend via the `@supabase/supabase-js` client SDK to fetch blueprints, start sessions, and execute turns.

**Note**: As part of this feature, we will also clean up existing project documentation (e.g., `docs/architecture.md` and others) to remove legacy references to `apps/` and ensure the `web/` directory at the root is correctly documented as the UI application location.

## Technical Context

**Language/Version**: TypeScript 5.x  
**Primary Dependencies**: SvelteKit, Svelte, Tailwind CSS, Vite, @supabase/supabase-js, Playwright
**Storage**: Local storage for minimal client state if needed (no DB directly accessed by UI)
**Testing**: Vitest for component tests, Playwright for E2E testing
**Target Platform**: Web browsers, deployed as static site on Cloudflare Pages
**Project Type**: web-app (Static Single Page Application)
**Performance Goals**: Fast initial load, responsive UI
**Constraints**: No SSR runtime, no secrets in browser bundle, 100% keyboard controllable, responsive design (down to 320px).
**Scale/Scope**: 2 screens (Game Start, Game Session)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Documentation reviewed and lean?
- [x] Testing strategy includes E2E (mandatory) and Unit/Integration?
- [x] Quality gates runnable?
- [x] Static UI + Supabase backend constraints respected?
- [x] Context-specific conventions applied?

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
```text
web/
├── e2e/                     # Playwright tests
├── src/
│   ├── lib/
│   │   ├── api/             # Supabase client and wrappers
│   │   ├── components/      # Reusable UI components (boxes, inputs, etc)
│   │   └── types/           # Frontend types (or imported from shared)
│   ├── routes/              # SvelteKit pages (+page.svelte)
│   └── app.html
├── tests/                   # Vitest tests
├── package.json
├── svelte.config.js
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

**Structure Decision**: The SvelteKit application will be placed in the `web/` directory at the root of the monorepo, as defined in the `package.json` workspaces configuration.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
