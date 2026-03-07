# Quickstart Guide

Welcome to the development environment!

## Prerequisites
Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/)
- [Docker](https://www.docker.com/) (Required for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) (Required for Edge Functions language server)

## Running the Backend Locally
The backend relies on Supabase for the database, auth, and edge functions.

1. **Start Supabase:**
   ```bash
   npx supabase start
   ```
   *This command spins up the Docker containers and applies all database migrations.*

2. **Seed Local Storage (Blueprints):**
   Run the seeding script to upload all local blueprint JSON files into your local Supabase Storage bucket:
   - `blueprints/*.json`
   - `supabase/seed/blueprints/*.json` (including `mock-blueprint.json` used by tests)
   ```bash
   npm run seed:storage
   ```

3. **Start the Web UI:**
   In a new terminal, navigate to the `web/` directory and start Vite:
   ```bash
   cd web
   npm run dev
   ```
   *The UI will usually be available at `http://localhost:5173`.*

Tip: `npm run dev` from the repository root restarts Supabase in deterministic mock-AI mode, seeds storage blueprints, then starts the web UI.

## Local human testing with AI
Use mode-specific local env files (gitignored) to run the full local stack against real models.

1. Create `.env.ai.free.local`:
   ```bash
   AI_PROVIDER="openrouter"
   AI_MODEL="z-ai/glm-4.5-air:free"
   OPENROUTER_API_KEY="<server-only-secret>"
   ```
2. Create `.env.ai.paid.local`:
   ```bash
   AI_PROVIDER="openrouter"
   AI_MODEL="google/gemini-3-flash-preview"
   OPENROUTER_API_KEY="<server-only-secret>"
   ```
3. Start local stack in AI mode:
   - Free model: `npm run dev:ai:free`
   - Paid model: `npm run dev:ai:paid`

## Testing everything
We have a unified Quality Gate script that checks linting, type-safety, and all test tiers (Unit, Integration, and E2E API flow).

Simply run:
```bash
npm run test:all
```

Alternatively, you can run tests in isolation:
- **Unit Logic Tests:** `npm run test:unit`
- **Integration Tests:** `npm run test:integration` (Restarts Supabase in mock-AI mode and reseeds storage blueprints)
- **E2E API Tests:** `npm run test:e2e` (Restarts Supabase in mock-AI mode and reseeds storage blueprints)

## Optional live-AI suites
Live suites are opt-in and intentionally excluded from `npm run test:all` to keep baseline checks deterministic.

1. Configure server-side AI environment:
   ```bash
   export AI_PROVIDER="openrouter"
   export OPENROUTER_API_KEY="<server-only-secret>"
   export AI_MODEL_PAID="google/gemini-3-flash-preview"
   export AI_MODEL_FREE="z-ai/glm-4.5-air:free"
   ```
2. Run live suites:
   - `npm run test:integration:live:free`
   - `npm run test:integration:live:paid`
   - `npm run test:e2e:live:free`
   - `npm run test:e2e:live:paid`

## Cloud Supabase secrets
Local `.env.ai.*.local` files are only for local Docker/Supabase CLI workflows.

For hosted Supabase, set project secrets per environment (for example staging vs production) in Supabase Dashboard or via CLI:
```bash
supabase secrets set AI_PROVIDER=openrouter AI_MODEL=<model-id> OPENROUTER_API_KEY=<secret> --project-ref <project-ref>
```

## Viewing the Database
You can explore the local Postgres database and functions via the local Supabase dashboard:
```bash
npx supabase status
```
*Look for the "Studio URL" in the output, typically `http://127.0.0.1:54323`.*
