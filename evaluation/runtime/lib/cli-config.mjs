// Shared plumbing for the runtime harness's pluggable CLIs: the bindings
// loader (config/cli.json, falling back to the committed
// config/cli.example.json) and the model-output JSON parser. Used by the cli
// model backend (narrator role variants) and the LLM judges (judge variants).

import fs from "node:fs/promises";
import path from "node:path";

/** Strip ```json fences a model may wrap around its JSON, then parse. */
export function parseFencedJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

const CONFIG_DIR = path.join("evaluation", "runtime", "config");

export async function loadCliConfig(variant) {
  const override = path.resolve(process.cwd(), CONFIG_DIR, "cli.json");
  const example = path.resolve(process.cwd(), CONFIG_DIR, "cli.example.json");
  let file = example;
  try {
    await fs.access(override);
    file = override;
  } catch {
    // fall back to the committed example
  }
  const all = JSON.parse(await fs.readFile(file, "utf-8"));
  const entry = all[variant];
  if (!entry) {
    throw new Error(
      `CLI variant "${variant}" not found in ${path.relative(process.cwd(), file)}. ` +
        `Known: ${Object.keys(all).filter((k) => !k.startsWith("_")).join(", ")}`,
    );
  }
  return entry;
}
