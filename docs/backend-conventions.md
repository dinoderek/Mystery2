# Backend Conventions

This document outlines the rules for AI agents and developers building Supabase Edge Functions and managing the database.

## 1. The Shared Boundary (API Contracts)

When we refer to the "Shared Boundary," we mean **specifically the data exchanged between the UI and the backend Edge Functions/Database**.

- The backend will hold comprehensive data models internally (e.g., the full `Blueprint` with internal reasoning).
- The frontend will only receive specific, sanitized _views_ of this data via API payloads (e.g., `PlayerVisibleBlueprint`).
- All data shapes at this network boundary (e.g., the `TurnRequest`, `TurnResponse`) must be defined as Zod schemas.
- The single source of truth for these API contracts lives in `packages/shared/src/mystery-api-contracts.ts`.
- TypeScript types are inferred from these Zod schemas (e.g., `export type TurnResponse = z.infer<typeof TurnResponseSchema>;`).
- AI Agents must always update these contract schemas first whenever the API boundary changes.

## 2. Supabase Edge Functions (Deno)

All secure backend logic runs in **Supabase Edge Functions** (Deno runtime).

- Functions live in `supabase/functions/<function-name>/`.
- Use standard Deno imports from `https://deno.land/...` or `npm:...`.
- Any shared logic or inferred types must be imported using valid Deno relative paths (including the `.ts` extension).
- Edge Functions are responsible for wrapping the AI provider (OpenRouter) using server-side secrets. The UI never calls OpenRouter directly.

## 3. Postgres & RLS

- All data access from the UI must happen via the Supabase Javascript Client utilizing Row Level Security (RLS).
- Edge Functions run with a Service Role key (bypassing RLS) when they need to do privileged operations, but they MUST manually verify the user's identity based on the passed JWT before performing any sensitive actions on their behalf.
- Database schema changes strictly go through `supabase/migrations/`.

## 4. Error Handling & Testing

- Edge functions must return standard HTTP status codes (e.g., 400 for bad input, 401 for unauthorized, 500 for internal errors).
- Responses must include a consistent JSON error shape (e.g., `{ error: string, details?: any }`) so the UI can predictably render error messages to the user.
- **Testing:** All error conditions and failure branches within Edge Functions MUST be covered by integration tests (e.g., testing what happens when an invalid token is provided, when a blueprint cannot be found, or when OpenRouter rate-limits the request).
