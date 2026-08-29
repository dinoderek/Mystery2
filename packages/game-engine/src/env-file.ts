// Reading `.env*.local` files.
//
// A deliberate re-implementation rather than an import of
// `scripts/supabase-utils.mjs`: that module boots Docker containers and is
// deleted with the rest of the Supabase tooling in P5, and the engine must not
// depend on it. The parsing rules match it exactly — `KEY=value`, `#` comments,
// blank lines ignored, one layer of matching quotes stripped — so the same
// files keep meaning the same thing.

import fs from "node:fs";

export type EnvRecord = Record<string, string | undefined>;

export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (!key) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

/** Parsed contents of the file, or `{}` when it does not exist. */
export function readEnvFile(filePath: string): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
