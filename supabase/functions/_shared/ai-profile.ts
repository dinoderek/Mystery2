import type { AIRuntimeProfile } from "./ai-provider.ts";
import { createClient } from "./db.ts";

export const DEFAULT_AI_PROFILE_ID = "default";

export interface StoredAIProfile extends AIRuntimeProfile {
  id: string;
  openrouter_api_key: string | null;
}

function parseStoredAIProfile(value: unknown): StoredAIProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

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
    openrouter_api_key: typeof openrouterApiKey === "string"
      ? openrouterApiKey.trim() || null
      : null,
  };
}

export async function getAIProfileById(
  profileId: string,
): Promise<StoredAIProfile | null> {
  const trimmedId = profileId.trim();
  if (!trimmedId) {
    return null;
  }

  const adminClient = createClient();
  const { data, error } = await adminClient
    .from("ai_profiles")
    .select("id,provider,model,openrouter_api_key")
    .eq("id", trimmedId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load ai profile "${trimmedId}": ${error.message}`);
  }

  return parseStoredAIProfile(data);
}

export async function getDefaultAIProfile(): Promise<StoredAIProfile | null> {
  return getAIProfileById(DEFAULT_AI_PROFILE_ID);
}
