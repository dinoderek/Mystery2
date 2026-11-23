import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";

/**
 * The schema changes with no compatibility path, so every blueprint the repo
 * holds must parse under it: the installed ones, the runtime fixtures, the
 * ones embedded in stored traces, and fixtures. A blueprint is any object with
 * `schema_version: "v2"` and a `world`, wherever it sits in a tracked JSON file.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");

function trackedJsonFiles(): string[] {
  const listed = spawnSync("git", ["ls-files", "-z", "--", "*.json"], { cwd: ROOT, encoding: "utf8" });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return listed.stdout.split("\0").filter(Boolean);
}

function embeddedBlueprints(value: unknown, at: string): Array<{ at: string; blueprint: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => embeddedBlueprints(item, `${at}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (record.schema_version === "v2" && "world" in record) return [{ at, blueprint: value }];
  return Object.entries(record).flatMap(([key, item]) => embeddedBlueprints(item, `${at}.${key}`));
}

/** A tracked file's JSON, or null for a config with comments, which holds no blueprint. */
function readJson(file: string): unknown {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    if (/"schema_version"\s*:\s*"v2"/.test(text)) throw new Error(`${file} names a v2 blueprint but is not JSON`, { cause: error });
    return null;
  }
}

const found = trackedJsonFiles().flatMap((file) =>
  embeddedBlueprints(readJson(file), file).map((entry) => ({ file, ...entry })),
);

describe("every committed blueprint", () => {
  it("is found in the places blueprints are kept", () => {
    const files = new Set(found.map(({ file }) => file));
    for (const expected of [
      "blueprints/mock-blueprint.json",
      "tests/api/unit/fixtures/snow-foxes-trace.json",
    ]) {
      expect(files.has(expected), expected).toBe(true);
    }
  });

  it.each(found.map(({ at, blueprint }) => [at, blueprint] as const))("%s parses", (_at, blueprint) => {
    const result = BlueprintV2Schema.safeParse(blueprint);
    expect(result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)).toEqual([]);
  });
});
