import { readFile } from "node:fs/promises";

import { BlueprintGenerationError } from "./errors.ts";

const CLUE_GRAPH_PROMPT_URL = new URL("./clue-graph-prompt.md", import.meta.url);

/** The clue-graph generator's prompt, whole: it has no age section. */
export async function loadClueGraphGeneratorPrompt(): Promise<string> {
  try {
    return await readFile(CLUE_GRAPH_PROMPT_URL, "utf-8");
  } catch (error) {
    throw new BlueprintGenerationError("PROMPT_LOAD_FAILED", "Failed to load clue-graph generator prompt", {}, error);
  }
}
