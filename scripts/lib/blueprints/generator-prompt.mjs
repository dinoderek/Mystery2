import fs from "node:fs/promises";
import path from "node:path";

const PROMPT_TEMPLATE_PATH = path.join(
  "supabase",
  "functions",
  "_shared",
  "blueprints",
  "generator-prompt.md",
);

const BLUEPRINT_SCHEMA_PATH = path.join(
  "supabase",
  "functions",
  "_shared",
  "blueprints",
  "blueprint-schema.ts",
);

export async function loadBlueprintGeneratorPrompt(rootDir = process.cwd()) {
  const [template, schemaSource] = await Promise.all([
    fs.readFile(path.join(rootDir, PROMPT_TEMPLATE_PATH), "utf-8"),
    fs.readFile(path.join(rootDir, BLUEPRINT_SCHEMA_PATH), "utf-8"),
  ]);

  return [
    template.trim(),
    "",
    "## Blueprint Schema Source of Truth",
    "The following TypeScript/Zod schema is the exact source of truth for field names, nesting, enum values, and `.describe()` guidance.",
    "Follow it exactly. Do not invent legacy Blueprint V1 fields.",
    "",
    "```ts",
    schemaSource.trim(),
    "```",
  ].join("\n");
}
