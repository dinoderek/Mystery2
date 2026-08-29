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

### The `EngineContext` seam

Handlers do **not** touch the Supabase client. Each endpoint exports

```ts
export async function handle(req: Request, ctx: EngineContext): Promise<Response>
```

and keeps a thin `serveWithCors` wrapper that checks the HTTP method, calls
`requireEngineContext(req)`, and delegates. `EngineContext`
(`supabase/functions/_shared/context.ts`) is the engine's whole boundary against
its host: `ctx.sessions`, `ctx.events`, `ctx.content`, `ctx.aiProfiles`, and
`ctx.player`. The Supabase implementation lives in `context-supabase.ts` and is
the only file that speaks the query builder, holds a service-role client, or
knows what a storage bucket is.

Rules:

- Add a **named operation** to the relevant store interface rather than reaching
  for a client. If a handler needs a query that does not exist yet, extend
  `context.ts` and implement it in `context-supabase.ts`.
- Keep the method check ahead of `requireEngineContext` so an unsupported method
  still returns `405` without authenticating.
- Error convention: a genuine backend failure **throws**, and "does not exist"
  returns `null`/empty. Handlers map a throw to `500` and a `null` to `404`/`400`.

This exists so the engine can be re-hosted without touching game logic. Anything
that bypasses the seam has to be ported by hand later, so treat a direct client
reference in a handler as a bug.

#### The two implementations

There are now two adapters behind the seam, and a new named operation has to be
implemented in **both**:

| | Supabase | Local |
|---|---|---|
| File | `supabase/functions/_shared/context-supabase.ts` | `packages/game-engine/src/context-local.ts` |
| Sessions / events | Postgres via the query builder, RLS | SQLite; `player_id = ?` in the repository |
| Blueprints / images | two storage buckets, signed URLs | files on disk, a same-origin `/api/images/...` path |
| AI profiles | the `ai_profiles` table, read with a service-role client | `AI_PROVIDER` / `AI_MODEL` / `OPENROUTER_API_KEY` from the env |

The local adapter is not wired to a running server yet — P3 of the
local-execution plan moves the endpoint handlers out of `supabase/functions/`
and puts SvelteKit in front of them. Until then it is exercised by the
`tests/api/unit/local-engine-*.test.ts` suites.

One naming note: `GameSessionRow`/`NewGameSession` call the owning player
`player_id`, which is the local column name. Postgres still calls that column
`user_id`, and `context-supabase.ts` maps between the two.

### Sharing code with `packages/shared`

An Edge Function **cannot** import out of `supabase/functions`. The local edge
runtime container bind-mounts only that directory, so a relative path escaping
it (`../../../packages/shared/...`) resolves to a path that does not exist
inside the container. Code shared with the Node side therefore takes one of two
forms:

- **Verbatim mirror** — for a module with **no imports**, keep the canonical
  copy in `packages/shared/src/` and mirror it byte-for-byte into
  `supabase/functions/_shared/`. Declare the pair in `MIRRORED_FILES`
  (`scripts/sync-shared.mjs`), edit only the canonical file, and run
  `npm run sync:shared`. Both files carry a MIRRORED FILE banner naming which
  is which. Enforcement is two-layer: the `shared-sync` gate step
  (`npm run check:shared-sync`) and `tests/api/unit/shared-sync.test.ts`, which
  also fails if a mirrored file grows an import.
  Current mirror: `age-profile.ts`.
- **Hand-written adapter** — for anything with imports, since the runtimes
  resolve specifiers differently (`zod` vs `npm:zod`). The adapter is a real,
  separately maintained file and is *not* byte-identical; see
  `supabase/functions/_shared/blueprints/blueprint-schema-v2.ts`.

### Registering a new function

`supabase/config.toml` is **generated per worktree and gitignored**. Add the
`[functions.<name>] verify_jwt = false` block to `supabase/config.toml.template`
instead, then run `npm run supabase:patch` (or any `supabase:*` script) to
regenerate. Editing the generated file directly is silently undone on the next
restart. Also add the function to the endpoint list in
`tests/api/integration/cors-preflight.test.ts`; `scripts/deploy.mjs` discovers
functions from the directory and needs no change.

### Turn-free endpoints

Not every action spends a turn. `game-end-talk` and `game-enter` both leave
`time_remaining` and `current_location_id` untouched and only append a narration
event. `game-enter` additionally guards on the session's event history — it is
valid exactly once, when the only event is `start` — so a repeated call cannot
duplicate the arrival.

### Event payloads name the scene

The client groups the transcript into pages and labels each one from the
event payload, so a page-opening event must carry the name and image of where
the player now is:

- `move` (`game-move`, `game-enter`) — `location_name`, `location_image_id`
- `talk` / `ask` — `character_name`, `character_portrait_image_id`
- `end_talk` — `location_name` and `location_image_id` of the room the player
  has returned to, alongside the `character_name` they were speaking to.
  Without the location fields the page would be labelled and illustrated with
  the character they just walked away from.

## 3. Postgres & RLS

- All data access from the UI must happen via the Supabase Javascript Client utilizing Row Level Security (RLS).
- Edge Functions run with a Service Role key (bypassing RLS) when they need to do privileged operations, but they MUST manually verify the user's identity based on the passed JWT before performing any sensitive actions on their behalf.
- Database schema changes strictly go through `supabase/migrations/`.
- **Every new table in the `public` schema must explicitly grant DML to the
  API roles.** Recent Supabase CLI / Postgres versions no longer auto-grant
  `public` to `anon`, `authenticated`, and `service_role`, so a table without
  grants exposes no `SELECT/INSERT/UPDATE/DELETE` and all PostgREST access
  (seed scripts, Edge Functions, the REST API) fails with `permission denied
  for table ...`. Add, in the table's migration:
  `grant select, insert, update, delete on table <name> to anon, authenticated, service_role;`
  (grant `usage, select` on any owned sequences too). RLS still governs row
  visibility for `anon`/`authenticated`; these grants only restore table-level
  access. See `supabase/migrations/0012_grant_table_privileges.sql`.

## 4. Error Handling & Testing

- Edge functions must return standard HTTP status codes (e.g., 400 for bad input, 401 for unauthorized, 500 for internal errors).
- Responses must include a consistent JSON error shape (e.g., `{ error: string, details?: any }`) so the UI can predictably render error messages to the user.
- **Testing:** All error conditions and failure branches within Edge Functions MUST be covered by integration tests (e.g., testing what happens when an invalid token is provided, when a blueprint cannot be found, or when OpenRouter rate-limits the request).
