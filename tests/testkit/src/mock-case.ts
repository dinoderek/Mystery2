// The default test fixture: the clue-graph mock case, a small authored case
// the mock narrator plays deterministically (`docs/testing.md`).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClueGraphWorld, clueGraphCaseId, validateClueGraph, type ClueGraphCase, type ClueGraphWorld } from "@my2/shared";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** The case file, relative to the repository root, as runtime cases and judges name it. */
export const MOCK_CASE_PATH = "blueprints/clue-graph/mock-case.json";

/** The case's `metadata.id`, which names it to the playtest and generator CLIs. */
export const MOCK_CASE_SLUG = "mock-case";

/** The catalog ID the API names the case by. */
export const MOCK_CASE_ID = clueGraphCaseId(MOCK_CASE_SLUG);

/** The validated case file. */
export function readMockCaseGraph(): ClueGraphCase {
  return validateClueGraph(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MOCK_CASE_PATH), "utf8")));
}

/** The world view the engine plays the case through. */
export function readMockCase(): ClueGraphWorld {
  return buildClueGraphWorld(readMockCaseGraph());
}
