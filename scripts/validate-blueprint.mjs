import fs from "node:fs/promises";
import path from "node:path";
import { BlueprintV2Schema } from "../packages/shared/src/blueprint-schema-v2.ts";
import { getBlueprintsDir } from "./local-config.mjs";

const ROOT_DIR = process.cwd();

function resolveBlueprintPath(input) {
  const candidate = path.resolve(input);
  if (path.isAbsolute(input) || input.startsWith(".")) return candidate;

  const inConfigDir = path.join(getBlueprintsDir(ROOT_DIR, process.env), input);
  return inConfigDir;
}

try {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node scripts/validate-blueprint.mjs <blueprint.json>");
    process.exit(1);
  }

  const filePath = resolveBlueprintPath(input);
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    console.error(`Could not read file: ${filePath}`);
    process.exit(1);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error(`Invalid JSON: ${e.message}`);
    process.exit(1);
  }

  const result = BlueprintV2Schema.safeParse(json);
  if (result.success) {
    console.log(`Valid blueprint: ${filePath}`);
  } else {
    console.error(`Invalid blueprint: ${filePath}\n`);
    for (const issue of result.error.issues) {
      const loc = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      console.error(`  ${loc}: ${issue.message}`);
    }
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
