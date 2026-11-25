/**
 * The prompt versions a run records: a short hash of the narrator's prompt
 * files and one of the generator's. A hash needs no upkeep; the perf index
 * orders versions by when each was first seen (`evaluation/perf/README.md`).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What the game's narrator is sent: the role prompts, the guidance they embed,
 * the system messages and the age profile that sets lengths. Every file is under
 * a path `baseline status` treats as read (`baseline-status.ts`); a test holds
 * the two lists together. A hash needs no upkeep for an edit to these files, but
 * a prompt moved into a file not listed here must be added to the list.
 */
export const NARRATOR_PROMPT_FILES: readonly string[] = [
  "packages/game-engine/src/ai-prompts.ts",
  "packages/game-engine/src/role-request.ts",
  "packages/game-engine/src/clue-graph/prompts.ts",
  "packages/game-engine/src/clue-graph/judge-guidance.ts",
  "packages/shared/src/age-profile.ts",
];

/** What the generator agent is sent: its prompt, the task message beside the brief (`index.ts`) and the instructions of its workspace. */
export const GENERATOR_PROMPT_FILES: readonly string[] = [
  "packages/blueprint-generator/src/clue-graph-prompt.md",
  "packages/blueprint-generator/src/index.ts",
  "evaluation/generator-harness/template/clue-graph/CLAUDE.md",
];

/** The prompt versions of one checkout, in `run.prompt_versions`. */
export interface PromptVersions {
  narrator: string;
  generator: string;
}

const HASH_LENGTH = 12;

/**
 * The first 12 hex digits of a SHA-256 over each file's path and content. A file that cannot be read
 * throws: a version that silently left a file out would not change when that file did.
 */
export function hashPromptFiles(root: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(file).update("\0").update(fs.readFileSync(path.join(root, file))).update("\0");
  }
  return hash.digest("hex").slice(0, HASH_LENGTH);
}

/** The checkout this module runs from: the prompts a run sends are the ones it loads from here. */
const THIS_CHECKOUT = fileURLToPath(new URL("../..", import.meta.url));

export function promptVersions(root: string = THIS_CHECKOUT): PromptVersions {
  return { narrator: hashPromptFiles(root, NARRATOR_PROMPT_FILES), generator: hashPromptFiles(root, GENERATOR_PROMPT_FILES) };
}
