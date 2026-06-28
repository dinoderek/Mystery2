import { describe, expect, it } from "vitest";

import { worktreeProjectId } from "../../../scripts/worktree-ports.mjs";

/**
 * `worktreeProjectId` is the single source of truth for the Supabase/Docker
 * project_id derived from a worktree name. It is written into
 * `supabase/config.toml` (becoming the running containers'
 * `com.supabase.cli.project` label) AND used by the worktree GC to recognise a
 * live stack. If the two derivations ever disagree, the GC will treat a live
 * worktree as orphaned and force-remove its stack — so these invariants matter.
 */
describe("worktreeProjectId", () => {
  it("prefixes the (≤16-char) worktree name with mystery-wt-", () => {
    expect(worktreeProjectId("playwright-perf")).toBe("mystery-wt-playwright-perf");
  });

  it("truncates names longer than 16 chars", () => {
    expect(worktreeProjectId("intelligent-galileo-c5d536")).toBe(
      "mystery-wt-intelligent-gali",
    );
  });

  it("trims a trailing hyphen left by the 16-char slice (regression)", () => {
    // "heuristic-wiles-cffc71".slice(0,16) === "heuristic-wiles-" — a trailing
    // hyphen is an invalid DNS/Docker hostname label and must be stripped.
    expect(worktreeProjectId("heuristic-wiles-cffc71")).toBe(
      "mystery-wt-heuristic-wiles",
    );
  });

  it("never produces an id whose worktree segment ends in a hyphen", () => {
    const names = [
      "heuristic-wiles-cffc71",
      "a-b-c-d-e-f-g-h-i-j-k", // hyphen lands exactly on the 16th char
      "keen-brown-59544",
      "x",
    ];
    for (const name of names) {
      expect(worktreeProjectId(name).endsWith("-")).toBe(false);
    }
  });
});
