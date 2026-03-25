import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { SUPABASE_URL } from "./auth-helpers";

const ROOT_DIR = path.resolve(__dirname, "../../..");
const NODE_BIN = process.execPath;
const DEFAULT_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function runSeedStorage(extraArgs: string[]) {
  const result = spawnSync(
    NODE_BIN,
    ["scripts/seed-storage.mjs", ...extraArgs],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        API_URL: SUPABASE_URL,
        SERVICE_ROLE_KEY: process.env.SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY,
      },
      encoding: "utf-8",
    },
  );

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("blueprint image deploy behavior", () => {
  it("allows missing images by default while emitting manifest details", () => {
    const result = runSeedStorage(["--seed-images=always"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Image sync manifest:");
  });

  it("fails in strict mode when referenced images are missing", () => {
    const result = runSeedStorage(["--seed-images=always", "--strict-images"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("strict policy");
  });
});
