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
   Run the seeding script to upload the required mock blueprints to your local Supabase Storage bucket.
   ```bash
   # Load the local `.env.local` file and run the seed script
   set -a; source .env.local; set +a
   node scripts/seed-storage.mjs
   ```

3. **Start the Web UI:**
   In a new terminal, navigate to the `web/` directory and start Vite:
   ```bash
   cd web
   npm run dev
   ```
   *The UI will usually be available at `http://localhost:5173`.*

## Testing everything
We have a unified Quality Gate script that checks linting, type-safety, and all test tiers (Unit, Integration, and E2E API flow).

Simply run:
```bash
npm run test:all
```

Alternatively, you can run tests in isolation:
- **Unit Logic Tests:** `npm run test:unit`
- **Integration Tests:** `npm run test:integration` (Expects local Supabase to be running)
- **E2E API Tests:** `npm run test:e2e` (Ensures local Supabase is running before execution)

## Optional live-AI suites
Live suites are opt-in and intentionally excluded from `npm run test:all` to keep baseline checks deterministic.

1. Configure server-side AI environment:
   ```bash
   export AI_PROVIDER="openrouter"
   export OPENROUTER_API_KEY="<server-only-secret>"
   export AI_PROFILE_DEFAULT_MODEL="google/gemini-2.5-flash"
   export AI_PROFILE_COST_CONTROL_MODEL="z-ai/glm-4.5-air:free"
   ```
2. Run live suites:
   - `npm run test:integration:live:default`
   - `npm run test:integration:live:cost-control`
   - `npm run test:e2e:live:default`
   - `npm run test:e2e:live:cost-control`

## Viewing the Database
You can explore the local Postgres database and functions via the local Supabase dashboard:
```bash
npx supabase status
```
*Look for the "Studio URL" in the output, typically `http://127.0.0.1:54323`.*
