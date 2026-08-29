// Supabase implementation of `EngineContext`.
//
// This is the only file in the engine that speaks the Supabase client's query
// builder, holds a service-role client, or knows what a storage bucket is.
// When the game moves to local execution this file is replaced wholesale by a
// SQLite + filesystem implementation and nothing above it changes.

import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";
import {
  BlueprintV2Schema,
  type BlueprintV2,
} from "./blueprints/blueprint-schema-v2.ts";
import { requireAuth, isAuthError } from "./auth.ts";
import { createClient as createServiceRoleClient } from "./db.ts";
import { BLUEPRINT_IMAGES_BUCKET } from "./images.ts";
import type { LogWriter } from "./logging.ts";
import type {
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
} from "./context.ts";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

const BLUEPRINTS_BUCKET = "blueprints";

/** Columns every event consumer needs; superset of the previous per-call lists. */
const EVENT_COLUMNS =
  "sequence,event_type,actor,narration,payload,narration_parts,model,created_at";

const SESSION_SUMMARY_COLUMNS =
  "id, blueprint_id, mode, time_remaining, outcome, updated_at, created_at";

/**
 * Storage downloads can fail intermittently under concurrent load — a momentary
 * blip in the storage/auth path returns an error even though the object exists
 * and the same client read it successfully moments earlier. Surfacing that as a
 * 500 mid-session is a player-visible flake, so transient misses get a bounded
 * retry. (The integration test fixture seeder retries for the same reason.)
 */
const DOWNLOAD_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SupabaseSessionStore implements SessionStore {
  #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  async getById(gameId: string): Promise<GameSessionRow | null> {
    const { data, error } = await this.#client
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data as GameSessionRow | null) ?? null;
  }

  async create(session: NewGameSession): Promise<string> {
    const { data, error } = await this.#client
      .from("game_sessions")
      .insert(session)
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async update(gameId: string, patch: GameSessionPatch): Promise<void> {
    const { error } = await this.#client
      .from("game_sessions")
      .update(patch)
      .eq("id", gameId);

    if (error) throw new Error(error.message);
  }

  async listForPlayer(): Promise<GameSessionSummaryRow[]> {
    const { data, error } = await this.#client
      .from("game_sessions")
      .select(SESSION_SUMMARY_COLUMNS);

    if (error) throw new Error(error.message);
    return (data as GameSessionSummaryRow[] | null) ?? [];
  }
}

class SupabaseEventStore implements EventStore {
  #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  async listBySession(gameId: string): Promise<GameEventRow[]> {
    const { data, error } = await this.#client
      .from("game_events")
      .select(EVENT_COLUMNS)
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    if (error) throw new Error(error.message);
    return (data as GameEventRow[] | null) ?? [];
  }

  async nextSequence(gameId: string): Promise<number> {
    const { data, error } = await this.#client
      .from("game_events")
      .select("sequence")
      .eq("session_id", gameId)
      .order("sequence", { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);
    const rows = (data as Array<{ sequence: number }> | null) ?? [];
    return rows.length > 0 ? rows[0].sequence + 1 : 1;
  }

  async insert(event: NewGameEvent): Promise<void> {
    const { error } = await this.#client.from("game_events").insert(event);
    if (error) throw new Error(error.message);
  }
}

class SupabaseContentStore implements ContentStore {
  #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  /** Downloads one object's text, retrying transient storage failures. */
  async #downloadText(name: string, logger?: LogWriter): Promise<string | null> {
    let lastErrorMessage: string | null = null;
    let lastErrorName: string | null = null;

    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
      const { data, error } = await this.#client.storage
        .from(BLUEPRINTS_BUCKET)
        .download(name);

      if (!error && data) return await data.text();

      lastErrorMessage = error?.message ?? null;
      lastErrorName = error?.name ?? null;

      if (attempt < DOWNLOAD_ATTEMPTS) {
        logger?.log("blueprint.download_retry", {
          object: name,
          attempt,
          download_error: lastErrorMessage,
        });
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }

    logger?.logError("blueprint.download_failed", {
      object: name,
      attempts: DOWNLOAD_ATTEMPTS,
      download_error: lastErrorMessage,
      download_error_name: lastErrorName,
    });
    return null;
  }

  async listBlueprints(logger?: LogWriter): Promise<BlueprintSummaryEntry[]> {
    const { data: files, error } = await this.#client.storage
      .from(BLUEPRINTS_BUCKET)
      .list();

    if (error) throw new Error(error.message);

    const entries: BlueprintSummaryEntry[] = [];
    for (const file of files ?? []) {
      if (!file.name.endsWith(".json")) continue;

      const text = await this.#downloadText(file.name, logger);
      if (text === null) continue;

      try {
        entries.push({
          blueprint: BlueprintV2Schema.parse(JSON.parse(text)),
          source: file.name,
        });
      } catch (parseError) {
        // A malformed or schema-invalid blueprint is skipped, not fatal: one
        // bad object in the bucket must not take down the whole catalog.
        logger?.logError("blueprint.parse_failed", {
          object: file.name,
          error:
            parseError instanceof Error ? parseError.message : String(parseError),
        });
      }
    }

    return entries;
  }

  async loadBlueprint(
    blueprintId: string,
    logger: LogWriter,
  ): Promise<BlueprintV2 | null> {
    // The canonical key is `<id>.json`; fall back to scanning the bucket for a
    // blueprint whose embedded id matches, for objects stored under old names.
    const text = await this.#downloadText(`${blueprintId}.json`, logger);
    if (text !== null) {
      const parsed = parseBlueprint(text, `${blueprintId}.json`, logger);
      if (parsed) return parsed;
    }

    for (const entry of await this.listBlueprints(logger)) {
      if (entry.blueprint.id === blueprintId) return entry.blueprint;
    }

    return null;
  }

  async imageUrl(
    storageKey: string,
    expiresInSeconds: number,
  ): Promise<string | null> {
    const { data, error } = await this.#client.storage
      .from(BLUEPRINT_IMAGES_BUCKET)
      .createSignedUrl(storageKey, expiresInSeconds);

    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }
}

function parseBlueprint(
  text: string,
  source: string,
  logger: LogWriter,
): BlueprintV2 | null {
  try {
    return BlueprintV2Schema.parse(JSON.parse(text));
  } catch (parseError) {
    logger.logError("blueprint.parse_failed", {
      object: source,
      error: parseError instanceof Error ? parseError.message : String(parseError),
    });
    return null;
  }
}

class SupabaseAIProfileStore implements AIProfileStore {
  async getById(profileId: string): Promise<EngineAIProfile | null> {
    const trimmedId = profileId.trim();
    if (!trimmedId) return null;

    // Profile rows carry the provider secret, so they are readable only by the
    // service role — this is the engine's one privileged read.
    const { data, error } = await createServiceRoleClient()
      .from("ai_profiles")
      .select("id,provider,model,openrouter_api_key")
      .eq("id", trimmedId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load ai profile "${trimmedId}": ${error.message}`);
    }

    return parseStoredAIProfile(data);
  }
}

function parseStoredAIProfile(value: unknown): EngineAIProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const provider = row.provider;
  const model = typeof row.model === "string" ? row.model.trim() : "";
  const openrouterApiKey = row.openrouter_api_key;

  if (!id || (provider !== "mock" && provider !== "openrouter") || !model) {
    return null;
  }

  return {
    id,
    provider,
    model,
    openrouter_api_key:
      typeof openrouterApiKey === "string" ? openrouterApiKey.trim() || null : null,
  };
}

/**
 * Builds the context for one request from an authenticated, user-scoped
 * Supabase client. All reads and writes through it stay subject to RLS.
 */
export function createSupabaseContext(
  client: SupabaseClient,
  player: EnginePlayer,
): EngineContext {
  return {
    player,
    sessions: new SupabaseSessionStore(client),
    events: new SupabaseEventStore(client),
    content: new SupabaseContentStore(client),
    aiProfiles: new SupabaseAIProfileStore(),
  };
}

/**
 * Authenticates the request and returns the context it should run as, or the
 * 401 `Response` to return directly. Every player-facing endpoint starts here.
 */
export async function requireEngineContext(
  req: Request,
): Promise<EngineContext | Response> {
  const authResult = await requireAuth(req);
  if (isAuthError(authResult)) return authResult;

  return createSupabaseContext(authResult.client, authResult.user);
}
