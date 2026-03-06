# w1 Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-05

## Active Technologies
- TypeScript 5.x + SvelteKit, Svelte, Tailwind CSS, Vite, @supabase/supabase-js, Playwrigh (002-web-ui)
- Local storage for minimal client state if needed (no DB directly accessed by UI) (002-web-ui)
- TypeScript 5.x (SvelteKit 2 / Svelte 5) + SvelteKit (static), Tailwind CSS, Playwright (E2E), Vitest (unit) (003-webui-command-parser)
- N/A (client-side only) (003-webui-command-parser)

- TypeScript via Deno (Edge Functions) + TypeScript (Vitest/Playwright tests) + Supabase Edge Functions (Deno runtime), Supabase JS client (v2), OpenRouter API (AI calls), Zod (schema validation) (001-supabase-api)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript via Deno (Edge Functions) + TypeScript (Vitest/Playwright tests): Follow standard conventions

## Recent Changes
- 003-webui-command-parser: Added TypeScript 5.x (SvelteKit 2 / Svelte 5) + SvelteKit (static), Tailwind CSS, Playwright (E2E), Vitest (unit)
- 002-web-ui: Added TypeScript 5.x + SvelteKit, Svelte, Tailwind CSS, Vite, @supabase/supabase-js, Playwrigh

- 001-supabase-api: Added TypeScript via Deno (Edge Functions) + TypeScript (Vitest/Playwright tests) + Supabase Edge Functions (Deno runtime), Supabase JS client (v2), OpenRouter API (AI calls), Zod (schema validation)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
