// Load the blueprint a case names.
//
// This used to upload the file into local Supabase storage so `game-start`
// could download it again. The server reads blueprints off disk, so all that
// is left is reading the file and checking it has an id.

import fs from "node:fs/promises";
import path from "node:path";

/** Reads a blueprint file and returns it with its absolute path. */
export async function ensureBlueprintSeeded(blueprintPath) {
  const absolute = path.resolve(process.cwd(), blueprintPath);
  const blueprint = JSON.parse(await fs.readFile(absolute, "utf-8"));

  if (!blueprint?.id) {
    throw new Error(`Blueprint ${absolute} is missing a top-level "id" field`);
  }

  return { blueprint, blueprintPath: absolute };
}
