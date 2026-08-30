/**
 * Reading `.env*.local` files from script-land.
 *
 * A thin async wrapper over the engine's parser, so the scripts and the server
 * cannot disagree about what a `.env` file means.
 */

import { readEnvFile } from "../../packages/game-engine/src/env-file.ts";

/**
 * Parsed contents of the file, or `{}` when it does not exist.
 * @param {string} filePath
 * @param {boolean} [required] throw instead of returning `{}` when missing
 */
export async function loadEnvFile(filePath, required = false) {
  const vars = readEnvFile(filePath);

  if (required && Object.keys(vars).length === 0) {
    throw new Error(`Missing required env file: ${filePath}`);
  }

  return vars;
}
