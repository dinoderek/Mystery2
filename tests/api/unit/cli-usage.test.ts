import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { IMAGE_USAGE } from "../../../scripts/generate-blueprint-images.mjs";

/**
 * The image generator's `--help` is the only reference for its flags; no doc
 * repeats them. So the one thing to hold is that the help and the parser agree:
 * every flag the parser accepts is documented, and every documented flag is
 * accepted.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");

function parserFlags(script: string): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, script), "utf8");
  return [...source.matchAll(/token === "(--[a-z-]+)"/g)].map((m) => m[1]).sort();
}

function usageFlags(usage: string): string[] {
  const flags = [...usage.matchAll(/^\s+(?:-h, )?(--[a-z-]+)/gm)].map((m) => m[1]);
  return flags.filter((flag) => flag !== "--help").sort();
}

describe("image generation CLI help", () => {
  it("scripts/generate-blueprint-images.mjs documents exactly the flags it parses", () => {
    expect(usageFlags(IMAGE_USAGE)).toEqual(parserFlags("scripts/generate-blueprint-images.mjs"));
  });
});
