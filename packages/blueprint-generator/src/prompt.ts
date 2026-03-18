import { readFile } from "node:fs/promises";

import { BlueprintGenerationError } from "./errors.ts";

const GENERATOR_PROMPT_URL = new URL(
  "../../../supabase/functions/_shared/blueprints/generator-prompt.md",
  import.meta.url,
);

export async function loadBlueprintGeneratorPrompt(): Promise<string> {
  try {
    return await readFile(GENERATOR_PROMPT_URL, "utf-8");
  } catch (error) {
    throw new BlueprintGenerationError(
      "PROMPT_LOAD_FAILED",
      "Failed to load blueprint generator prompt",
      {},
      error,
    );
  }
}
