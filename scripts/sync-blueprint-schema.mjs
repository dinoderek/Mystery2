import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const sourcePath = path.join(ROOT_DIR, "packages", "shared", "src", "blueprint-schema.ts");
const targetPath = path.join(
  ROOT_DIR,
  "supabase",
  "functions",
  "_shared",
  "blueprints",
  "blueprint-schema.ts",
);

const source = await fs.readFile(sourcePath, "utf-8");
const synced = source.replace(
  'import { z } from "zod";',
  [
    "// Generated from packages/shared/src/blueprint-schema.ts for Supabase Edge Functions.",
    "// Keep this file in sync with the shared schema using scripts/sync-blueprint-schema.mjs.",
    "",
    'import { z } from "npm:zod";',
  ].join("\n"),
);

await fs.writeFile(targetPath, synced, "utf-8");
console.log(`Synced blueprint schema to ${path.relative(ROOT_DIR, targetPath)}`);
