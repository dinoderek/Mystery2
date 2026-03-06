# w1 Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-05

## Active Technologies
- TypeScript 5.x + SvelteKit, Svelte, Tailwind CSS, Vite, @supabase/supabase-js, Playwrigh (002-web-ui)
- Local storage for minimal client state if needed (no DB directly accessed by UI) (002-web-ui)

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
- 002-web-ui: Added TypeScript 5.x + SvelteKit, Svelte, Tailwind CSS, Vite, @supabase/supabase-js, Playwrigh

- 001-supabase-api: Added TypeScript via Deno (Edge Functions) + TypeScript (Vitest/Playwright tests) + Supabase Edge Functions (Deno runtime), Supabase JS client (v2), OpenRouter API (AI calls), Zod (schema validation)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
