// Ensure a blueprint fixture is present in local Supabase storage so game-start
// can load it. Mirrors ensureMockBlueprintSeeded() from the API test helpers,
// but works for any blueprint file (keyed by its own `id`).

import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveEnv } from "./env.mjs";

/**
 * Read a blueprint JSON file, upload it to the `blueprints` bucket as
 * `<id>.json` if not already present, and return the parsed blueprint.
 */
export async function ensureBlueprintSeeded(blueprintPath, env = resolveEnv()) {
  const absolute = path.resolve(process.cwd(), blueprintPath);
  const raw = await fs.readFile(absolute, "utf-8");
  const blueprint = JSON.parse(raw);
  if (!blueprint?.id) {
    throw new Error(`Blueprint ${absolute} is missing a top-level "id" field`);
  }

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const objectKey = `${blueprint.id}.json`;

  const existing = await admin.storage.from("blueprints").download(objectKey);
  if (!existing.error && existing.data) {
    return { blueprint, blueprintPath: absolute };
  }

  const { error } = await admin.storage.from("blueprints").upload(objectKey, raw, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) {
    throw new Error(`Failed to seed blueprint ${objectKey}: ${error.message}`);
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error: downloadError } = await admin.storage
      .from("blueprints")
      .download(objectKey);
    if (!downloadError && data) {
      return { blueprint, blueprintPath: absolute };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Blueprint ${objectKey} uploaded but did not become readable in time`);
}
