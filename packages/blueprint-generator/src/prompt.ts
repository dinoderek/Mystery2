import { readFile } from "node:fs/promises";

import { BlueprintGenerationError } from "./errors.ts";

const GENERATOR_PROMPT_URL = new URL("./generator-prompt.md", import.meta.url);
const CLUE_GRAPH_PROMPT_URL = new URL("./clue-graph-prompt.md", import.meta.url);

async function loadPrompt(url: URL, what: string): Promise<string> {
  try {
    return await readFile(url, "utf-8");
  } catch (error) {
    throw new BlueprintGenerationError("PROMPT_LOAD_FAILED", `Failed to load ${what}`, {}, error);
  }
}

/** The Blueprint V2 generator's prompt, before its age section. */
export function loadBlueprintGeneratorPrompt(): Promise<string> {
  return loadPrompt(GENERATOR_PROMPT_URL, "blueprint generator prompt");
}

/** The clue-graph generator's prompt, whole: it has no age section. */
export function loadClueGraphGeneratorPrompt(): Promise<string> {
  return loadPrompt(CLUE_GRAPH_PROMPT_URL, "clue-graph generator prompt");
}
