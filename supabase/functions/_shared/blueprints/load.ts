import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";
import { BlueprintV2Schema, type BlueprintV2 } from "./blueprint-schema-v2.ts";
import type { LogWriter } from "../logging.ts";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

const DEFAULT_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Downloads and parses a blueprint from the `blueprints` storage bucket,
 * retrying transient storage failures with a short backoff.
 *
 * Storage reads can fail intermittently under concurrent load — a momentary
 * blip in the storage/auth path returns a download error even though the object
 * exists and the same client read it successfully moments earlier. Surfacing
 * that as a 500 mid-session is a player-visible flake. A bounded retry converts
 * those transient misses into successes. (The integration test fixture seeder
 * already retries storage reads for the same reason.)
 *
 * JSON/schema parse failures are deterministic, so they are logged and returned
 * as a miss without retrying.
 *
 * Returns the parsed blueprint, or `null` when it is genuinely unreadable after
 * all attempts — callers should surface their own error response in that case.
 */
export async function loadBlueprint(
  client: SupabaseClient,
  blueprintId: string,
  logger: LogWriter,
  attempts = DEFAULT_ATTEMPTS,
): Promise<BlueprintV2 | null> {
  let lastErrorMessage: string | null = null;
  let lastErrorName: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data, error } = await client.storage
      .from("blueprints")
      .download(`${blueprintId}.json`);

    if (!error && data) {
      try {
        return BlueprintV2Schema.parse(JSON.parse(await data.text()));
      } catch (parseError) {
        logger.logError("blueprint.parse_failed", {
          blueprint_id: blueprintId,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        return null;
      }
    }

    lastErrorMessage = error?.message ?? null;
    lastErrorName = error?.name ?? null;

    if (attempt < attempts) {
      logger.log("blueprint.download_retry", {
        blueprint_id: blueprintId,
        attempt,
        download_error: lastErrorMessage,
      });
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  logger.logError("blueprint.download_failed", {
    blueprint_id: blueprintId,
    attempts,
    download_error: lastErrorMessage,
    download_error_name: lastErrorName,
  });
  return null;
}
