import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureLocalAuthUsersFile,
  formatGeneratedAuthUsersNotice,
  generateAuthSeedPassword,
} from "../../../scripts/seed-auth-users.mjs";

describe("ensureLocalAuthUsersFile", () => {
  it("creates a local auth manifest with generated strong passwords", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "auth-users-"));
    const localPath = path.join(tmpDir, "supabase/seed/auth-users.local.json");
    const examplePath = path.join(tmpDir, "supabase/seed/auth-users.example.json");

    await mkdir(path.dirname(examplePath), { recursive: true });
    await writeFile(
      examplePath,
      JSON.stringify({
        users: [
          { email: "player1@test.local", email_confirm: true },
          { email: "player2@test.local", email_confirm: true },
        ],
      }),
      "utf-8",
    );

    const result = await ensureLocalAuthUsersFile({ localPath, examplePath });
    const stored = JSON.parse(await readFile(localPath, "utf-8")) as {
      users: Array<{ email: string; password: string; email_confirm?: boolean }>;
    };

    expect(result.created).toBe(true);
    expect(result.users).toHaveLength(2);
    expect(stored.users).toHaveLength(2);
    for (const user of stored.users) {
      expect(user.password.length).toBeGreaterThanOrEqual(6);
      expect(user.password).toMatch(/[A-Z]/);
      expect(user.password).toMatch(/[a-z]/);
      expect(user.password).toMatch(/[0-9]/);
      expect(user.password).toContain("!");
    }
  });

  it("preserves an existing local auth manifest on rerun", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "auth-users-existing-"));
    const localPath = path.join(tmpDir, "supabase/seed/auth-users.local.json");
    const examplePath = path.join(tmpDir, "supabase/seed/auth-users.example.json");

    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(
      localPath,
      JSON.stringify({
        users: [{ email: "player1@test.local", password: "Existing-Password-123!", email_confirm: true }],
      }),
      "utf-8",
    );
    await writeFile(
      examplePath,
      JSON.stringify({
        users: [{ email: "player1@test.local", email_confirm: true }],
      }),
      "utf-8",
    );

    const result = await ensureLocalAuthUsersFile({ localPath, examplePath });
    const stored = await readFile(localPath, "utf-8");

    expect(result.created).toBe(false);
    expect(result.users).toEqual([
      { email: "player1@test.local", password: "Existing-Password-123!", email_confirm: true },
    ]);
    expect(stored).toContain("Existing-Password-123!");
  });
});

describe("seed auth user helpers", () => {
  it("generates passwords that satisfy the local auth seed format", () => {
    const password = generateAuthSeedPassword();
    expect(password.length).toBeGreaterThanOrEqual(6);
    expect(password).toMatch(/^Local-/);
    expect(password).toContain("-Aa1!");
  });

  it("formats a usable generated-credentials notice", () => {
    const notice = formatGeneratedAuthUsersNotice(
      "/tmp/repo",
      "/tmp/repo/supabase/seed/auth-users.local.json",
      [{ email: "player1@test.local", password: "Local-abc123-Aa1!", email_confirm: true }],
    );

    expect(notice).toContain("Created local auth seed file");
    expect(notice).toContain("supabase/seed/auth-users.local.json");
    expect(notice).toContain("player1@test.local");
    expect(notice).toContain("Local-abc123-Aa1!");
  });

  it("shows absolute paths for auth manifests outside the repo root", () => {
    const notice = formatGeneratedAuthUsersNotice(
      "/tmp/repo",
      "/tmp/shared-config/supabase/seed/auth-users.local.json",
      [{ email: "player1@test.local", password: "Local-abc123-Aa1!", email_confirm: true }],
    );

    expect(notice).toContain("/tmp/shared-config/supabase/seed/auth-users.local.json");
  });
});
