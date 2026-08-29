// The engine's boundary contract, re-exported for the local implementation.
//
// `EngineContext` and its stores are defined in
// `supabase/functions/_shared/context.ts` and still live there because an Edge
// Function cannot import out of `supabase/functions` — the local edge runtime
// bind-mounts only that directory (see docs/backend-conventions.md §2). P3
// moves that file into this package once SvelteKit serves the endpoints and
// Deno is no longer the runtime; at that point this file becomes the
// definition instead of a pointer, and nothing importing it has to change.
//
// Every import here is type-only, so nothing in the Deno tree is loaded at
// runtime by Node.

export { DEFAULT_AI_PROFILE_ID } from "../../../supabase/functions/_shared/context.ts";

export type {
  AIProfileStore,
  BlueprintSummaryEntry,
  ContentStore,
  EngineAIProfile,
  EngineContext,
  EnginePlayer,
  EventStore,
  GameEventRow,
  GameSessionPatch,
  GameSessionRow,
  GameSessionSummaryRow,
  NewGameEvent,
  NewGameSession,
  SessionStore,
} from "../../../supabase/functions/_shared/context.ts";

export type { LogWriter } from "../../../supabase/functions/_shared/logging.ts";
export type { NarrationPart } from "../../../supabase/functions/_shared/narration.ts";
